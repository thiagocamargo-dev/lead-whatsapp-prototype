import { config } from '../config.js';
import { WHATSAPP_TEMPLATE_ID, type Lead } from '../models/lead.js';

export interface WhatsappSendResult {
  messageId: string;
  duplicate: boolean;
}

/** Erro de transporte/negócio ao chamar a API do WhatsApp. `retryable` decide se vale tentar de novo. */
export class WhatsappApiError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable = true) {
    super(message);
    this.name = 'WhatsappApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface WhatsappServiceOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export function buildIdempotencyKey(leadId: string): string {
  return `whatsapp:lead:${leadId}:${WHATSAPP_TEMPLATE_ID}`;
}

/** Client HTTP para a API (falsa) do WhatsApp Business. Aplica timeout e classifica erros para o retry. */
export class WhatsappService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: WhatsappServiceOptions = {}) {
    this.baseUrl = options.baseUrl ?? config.whatsappApiBaseUrl;
    this.timeoutMs = options.timeoutMs ?? config.whatsappHttpTimeoutMs;
  }

  async sendWelcomeMessage(lead: Pick<Lead, 'telefone' | 'nome' | 'empresa'>, idempotencyKey: string): Promise<WhatsappSendResult> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/fake-whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          para: lead.telefone,
          template_id: WHATSAPP_TEMPLATE_ID,
          variaveis: {
            nome: lead.nome.split(' ')[0],
            empresa: lead.empresa,
          },
          idempotency_key: idempotencyKey,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 503) {
        throw new WhatsappApiError(String(payload.error ?? 'API_UNAVAILABLE'), 503, true);
      }
      if (response.status >= 500) {
        throw new WhatsappApiError(String(payload.error ?? 'SIMULATED_WHATSAPP_FAILURE'), response.status, true);
      }
      if (!response.ok) {
        // Erros 4xx (payload inválido) não são retryable: reenviar o mesmo payload sempre vai falhar de novo.
        throw new WhatsappApiError(String(payload.error ?? `HTTP_${response.status}`), response.status, false);
      }

      return {
        messageId: String(payload.message_id),
        duplicate: Boolean(payload.duplicate),
      };
    } catch (error) {
      if (error instanceof WhatsappApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WhatsappApiError('WHATSAPP_TIMEOUT', undefined, true);
      }
      throw new WhatsappApiError(error instanceof Error ? error.message : 'UNKNOWN_ERROR', undefined, true);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
