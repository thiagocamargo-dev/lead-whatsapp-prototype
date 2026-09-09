import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  CreateLeadInput,
  FaturamentoBand,
  FuncionariosBand,
  Lead,
  LeadStatus,
  ProcessamentoStatus,
  WhatsappStatus,
} from '../models/lead.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  empresa TEXT NOT NULL,
  cargo TEXT NOT NULL,
  faturamento_anual TEXT NOT NULL,
  numero_de_funcionarios TEXT NOT NULL,
  status TEXT NOT NULL,
  score INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  qualificado_em TEXT,
  enviado_em TEXT,
  processamento_status TEXT NOT NULL DEFAULT 'idle',
  whatsapp_status TEXT NOT NULL DEFAULT 'not_applicable',
  whatsapp_message_id TEXT,
  idempotency_key TEXT,
  tentativas_envio INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  qualification_checked_em TEXT,
  sla_violation_logged_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_status ON leads(whatsapp_status);

-- Segunda camada de proteção contra duplicidade (independente da aplicação):
-- uma UNIQUE constraint real no banco garante que nunca existirá mais de uma
-- mensagem gravada para o mesmo par (lead_id, template_id), mesmo em cenários
-- de corrida ou bugs na camada de aplicação.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE(lead_id, template_id),
  FOREIGN KEY(lead_id) REFERENCES leads(id)
);
`;

export interface LeadRow extends Lead {}

export class LeadDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }
}

export interface UpdateLeadPatch {
  status?: LeadStatus;
  qualificado_em?: string | null;
  enviado_em?: string | null;
  processamento_status?: ProcessamentoStatus;
  whatsapp_status?: WhatsappStatus;
  whatsapp_message_id?: string | null;
  idempotency_key?: string | null;
  tentativas_envio?: number;
  ultimo_erro?: string | null;
  qualification_checked_em?: string | null;
  sla_violation_logged_em?: string | null;
}

export class LeadRepository {
  constructor(private readonly database: LeadDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db;
  }

  create(input: CreateLeadInput & { id: string; criado_em: string }): Lead {
    const stmt = this.db.prepare(`
      INSERT INTO leads (
        id, nome, telefone, empresa, cargo, faturamento_anual, numero_de_funcionarios,
        status, score, criado_em, qualificado_em, enviado_em, processamento_status,
        whatsapp_status, whatsapp_message_id, idempotency_key, tentativas_envio,
        ultimo_erro, qualification_checked_em, sla_violation_logged_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'idle', 'not_applicable', NULL, NULL, 0, NULL, NULL, NULL)
    `);
    stmt.run(
      input.id,
      input.nome,
      input.telefone,
      input.empresa,
      input.cargo,
      input.faturamento_anual,
      input.numero_de_funcionarios,
      input.status ?? 'new',
      input.score,
      input.criado_em,
    );
    return this.getById(input.id)!;
  }

  getById(id: string): Lead | undefined {
    const row = this.db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    return row as unknown as Lead | undefined;
  }

  listAll(): Lead[] {
    return this.db.prepare('SELECT * FROM leads ORDER BY criado_em ASC').all() as unknown as Lead[];
  }

  /** Leads ainda não avaliados pela regra de qualificação (status 'new', nunca checados). */
  listPendingQualificationCheck(): Lead[] {
    return this.db
      .prepare("SELECT * FROM leads WHERE status = 'new' AND qualification_checked_em IS NULL")
      .all() as unknown as Lead[];
  }

  /** Leads qualificados aguardando envio ou em retry — usados na recuperação após falhas/offline. */
  listPendingWhatsappSend(maxTotalAttempts: number): Lead[] {
    return this.db
      .prepare(
        `SELECT * FROM leads
         WHERE status = 'qualificado'
           AND whatsapp_status IN ('pending', 'retrying')
           AND tentativas_envio < ?
         ORDER BY qualificado_em ASC`,
      )
      .all(maxTotalAttempts) as unknown as Lead[];
  }

  /** Leads qualificados que estouraram o SLA e ainda não foram enviados nem alertados. */
  listSlaViolations(slaSeconds: number): Lead[] {
    const thresholdIso = new Date(Date.now() - slaSeconds * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT * FROM leads
         WHERE status IN ('qualificado', 'processando', 'erro')
           AND whatsapp_status != 'enviado'
           AND qualificado_em IS NOT NULL
           AND qualificado_em <= ?
           AND sla_violation_logged_em IS NULL`,
      )
      .all(thresholdIso) as unknown as Lead[];
  }

  update(id: string, patch: UpdateLeadPatch): Lead {
    const fields = Object.keys(patch);
    if (fields.length === 0) return this.getById(id)!;

    const assignments = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => (patch as Record<string, SQLInputValue>)[f] ?? null);
    this.db.prepare(`UPDATE leads SET ${assignments} WHERE id = ?`).run(...values, id);
    return this.getById(id)!;
  }

  /**
   * Registra a mensagem enviada na tabela `messages`, protegida por UNIQUE(lead_id, template_id).
   * Retorna `false` (sem lançar) se a constraint impedir uma segunda gravação para o mesmo lead —
   * essa é a segunda camada de defesa contra duplicidade, independente da API falsa do WhatsApp.
   */
  recordMessageOnce(params: {
    id: string;
    leadId: string;
    templateId: string;
    messageId: string;
    idempotencyKey: string;
    sentAt: string;
  }): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO messages (id, lead_id, template_id, message_id, idempotency_key, sent_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(params.id, params.leadId, params.templateId, params.messageId, params.idempotencyKey, params.sentAt);
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw error;
    }
  }

  countMessagesForLead(leadId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM messages WHERE lead_id = ?').get(leadId) as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/.test(error.message)
  );
}

export function isValidFaturamentoBand(value: unknown): value is FaturamentoBand {
  return typeof value === 'string' && (['<500K', '500K-1M', '1M-5M', '5M-20M', '20M+'] as string[]).includes(value);
}

export function isValidFuncionariosBand(value: unknown): value is FuncionariosBand {
  return typeof value === 'string' && (['1-10', '11-50', '51-200', '201-500', '500+'] as string[]).includes(value);
}
