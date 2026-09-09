import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import type { LeadRepository } from '../database/database.js';
import { WHATSAPP_TEMPLATE_ID, type Lead } from '../models/lead.js';
import { evaluateQualification } from './qualification.service.js';
import { buildIdempotencyKey, WhatsappApiError, type WhatsappService } from './whatsapp.service.js';
import { log, maskPhone } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedSeconds(fromIso: string, toIso: string = nowIso()): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
}

/**
 * Orquestra o pipeline: qualificação -> envio de WhatsApp (com retry) -> monitoramento de SLA.
 * Cada método `sweep*` é uma varredura idempotente do banco, pensada para ser chamada
 * repetidamente pelo worker de polling (ou diretamente, no demo/testes).
 */
export class LeadProcessorService {
  constructor(
    private readonly repo: LeadRepository,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Avalia todos os leads 'new' ainda não checados. Retorna os que acabaram de ser qualificados. */
  sweepQualification(): Lead[] {
    const candidates = this.repo.listPendingQualificationCheck();
    const qualified: Lead[] = [];

    for (const lead of candidates) {
      const result = evaluateQualification(lead);
      const checkedAt = nowIso();

      if (result.qualified) {
        const updated = this.repo.update(lead.id, {
          status: 'qualificado',
          qualificado_em: checkedAt,
          whatsapp_status: 'pending',
          qualification_checked_em: checkedAt,
        });
        log('LEAD_QUALIFIED', {
          lead_id: lead.id,
          score: lead.score,
          cargo: lead.cargo,
          motivo: result.reasons.join('+') || 'score',
        });
        qualified.push(updated);
      } else {
        this.repo.update(lead.id, { qualification_checked_em: checkedAt });
        log('LEAD_REJECTED', {
          lead_id: lead.id,
          score: lead.score,
          cargo: lead.cargo,
          score_ok: result.scoreOk,
          sinal_adicional: result.cargoOk || result.faturamentoOk || result.funcionariosOk,
        });
      }
    }

    return qualified;
  }

  /** Processa todos os leads qualificados com envio pendente/em retry. */
  async sweepWhatsappSend(): Promise<Lead[]> {
    const pending = this.repo.listPendingWhatsappSend(config.maxTotalAttempts);
    const results: Lead[] = [];
    for (const lead of pending) {
      results.push(await this.sendForLead(lead));
    }
    return results;
  }

  /**
   * Tenta enviar a mensagem de boas-vindas para um lead qualificado, com retry local (backoff)
   * dentro deste ciclo. Se todas as tentativas locais falharem mas ainda houver orçamento de
   * tentativas totais, o lead volta para `whatsapp_status='retrying'` e será retomado no
   * próximo ciclo do worker (é assim que o sistema sobrevive a uma API fora do ar por minutos).
   */
  async sendForLead(lead: Lead): Promise<Lead> {
    this.repo.update(lead.id, { status: 'processando', processamento_status: 'processando' });
    const idempotencyKey = lead.idempotency_key ?? buildIdempotencyKey(lead.id);
    const attemptsAlready = lead.tentativas_envio;

    const result = await retryWithBackoff({
      delaysMs: config.retryDelaysMs,
      isRetryable: (error) => !(error instanceof WhatsappApiError) || error.retryable,
      onAttempt: ({ attempt }) => {
        const totalAttempt = attemptsAlready + attempt;
        log('WHATSAPP_ATTEMPT', {
          lead_id: lead.id,
          telefone: maskPhone(lead.telefone),
          attempt: totalAttempt,
        });
        this.repo.update(lead.id, { tentativas_envio: totalAttempt, idempotency_key: idempotencyKey });
      },
      onRetryableError: ({ attempt, error, nextDelayMs }) => {
        log('WHATSAPP_ERROR', {
          lead_id: lead.id,
          attempt: attemptsAlready + attempt,
          error,
          next_retry_ms: nextDelayMs,
        });
        this.repo.update(lead.id, { ultimo_erro: error ?? null });
      },
      fn: () => this.whatsapp.sendWelcomeMessage(lead, idempotencyKey),
    });

    if (result.success && result.value) {
      return this.finalizeSuccess(lead, result.value.messageId, idempotencyKey);
    }

    return this.finalizeFailure(lead, attemptsAlready + result.attempts, result.lastError);
  }

  private finalizeSuccess(lead: Lead, messageId: string, idempotencyKey: string): Lead {
    const sentAt = nowIso();

    // 2ª camada de proteção: mesmo que a API tenha (por algum bug) processado duas vezes,
    // a UNIQUE(lead_id, template_id) no banco garante uma única linha em `messages`.
    const recorded = this.repo.recordMessageOnce({
      id: uuidv4(),
      leadId: lead.id,
      templateId: WHATSAPP_TEMPLATE_ID,
      messageId,
      idempotencyKey,
      sentAt,
    });

    if (!recorded) {
      log('DUPLICATE_PREVENTED', { lead_id: lead.id, camada: 'database_unique_constraint' });
    }

    const updated = this.repo.update(lead.id, {
      status: 'enviado',
      whatsapp_status: 'enviado',
      processamento_status: 'concluido',
      whatsapp_message_id: messageId,
      enviado_em: sentAt,
      ultimo_erro: null,
    });

    const elapsed = lead.qualificado_em ? elapsedSeconds(lead.qualificado_em, sentAt) : 0;
    const sla = elapsed < config.slaSeconds ? 'PASS' : 'FAIL';
    log('WHATSAPP_SENT', {
      lead_id: lead.id,
      message_id: messageId,
      elapsed: `${elapsed.toFixed(1)}s`,
      sla,
    });

    return updated;
  }

  private finalizeFailure(lead: Lead, totalAttempts: number, lastError: unknown): Lead {
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError ?? 'ERRO_DESCONHECIDO');

    if (totalAttempts >= config.maxTotalAttempts) {
      const updated = this.repo.update(lead.id, {
        status: 'erro',
        whatsapp_status: 'erro',
        processamento_status: 'erro',
        ultimo_erro: errorMessage,
      });
      log('WHATSAPP_DEAD_LETTER', {
        lead_id: lead.id,
        tentativas: totalAttempts,
        ultimo_erro: errorMessage,
      });
      return updated;
    }

    const updated = this.repo.update(lead.id, {
      status: 'qualificado',
      whatsapp_status: 'retrying',
      processamento_status: 'erro',
      ultimo_erro: errorMessage,
    });
    log('WHATSAPP_PENDING_RETRY', {
      lead_id: lead.id,
      tentativas: totalAttempts,
      ultimo_erro: errorMessage,
    });
    return updated;
  }

  /** Encontra leads qualificados que estouraram o SLA e ainda não foram alertados. */
  sweepSlaViolations(): Lead[] {
    const violators = this.repo.listSlaViolations(config.slaSeconds);
    for (const lead of violators) {
      const elapsed = lead.qualificado_em ? elapsedSeconds(lead.qualificado_em) : 0;
      log('SLA_VIOLATION', {
        lead_id: lead.id,
        elapsed: `${elapsed.toFixed(0)}s`,
        status: 'FAIL',
      });
      this.repo.update(lead.id, { sla_violation_logged_em: nowIso() });
    }
    return violators;
  }
}
