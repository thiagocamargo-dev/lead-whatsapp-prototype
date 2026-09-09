export type LeadStatus = 'draft' | 'new' | 'qualificado' | 'processando' | 'enviado' | 'erro';

export type WhatsappStatus = 'not_applicable' | 'pending' | 'retrying' | 'enviado' | 'erro';

export type ProcessamentoStatus = 'idle' | 'processando' | 'concluido' | 'erro';

export const FATURAMENTO_BANDS = ['<500K', '500K-1M', '1M-5M', '5M-20M', '20M+'] as const;
export type FaturamentoBand = (typeof FATURAMENTO_BANDS)[number];

export const FUNCIONARIOS_BANDS = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;
export type FuncionariosBand = (typeof FUNCIONARIOS_BANDS)[number];

export interface Lead {
  id: string;
  nome: string;
  telefone: string;
  empresa: string;
  cargo: string;
  faturamento_anual: FaturamentoBand;
  numero_de_funcionarios: FuncionariosBand;
  status: LeadStatus;
  score: number;
  criado_em: string;

  // Observabilidade / SLA
  qualificado_em: string | null;
  enviado_em: string | null;

  // Idempotência / processamento
  processamento_status: ProcessamentoStatus;
  whatsapp_status: WhatsappStatus;
  whatsapp_message_id: string | null;
  idempotency_key: string | null;
  tentativas_envio: number;
  ultimo_erro: string | null;

  // Controle interno do worker (não fazem parte do domínio de negócio, mas evitam
  // reprocessamento infinito e ruído de logs em cada ciclo de polling)
  qualification_checked_em: string | null;
  sla_violation_logged_em: string | null;
}

export interface CreateLeadInput {
  nome: string;
  telefone: string;
  empresa: string;
  cargo: string;
  faturamento_anual: FaturamentoBand;
  numero_de_funcionarios: FuncionariosBand;
  score: number;
  status?: Extract<LeadStatus, 'draft' | 'new'>;
}

export const DECISION_MAKER_ROLES = [
  'ceo',
  'founder',
  'co-founder',
  'cofounder',
  'owner',
  'diretor',
  'diretora',
  'vp',
  'head',
  'gerente',
  'socio',
  'socia',
] as const;

export const WHATSAPP_TEMPLATE_ID = 'boas_vindas_lead';
