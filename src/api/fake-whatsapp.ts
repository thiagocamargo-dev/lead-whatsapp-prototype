import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { WHATSAPP_TEMPLATE_ID } from '../models/lead.js';
import { isValidPhone } from '../utils/validation.js';

/**
 * Estado da API falsa do WhatsApp. Fica isolado por instância (não é um singleton global)
 * para permitir múltiplas instâncias independentes em testes e no demo.
 */
export interface FakeWhatsappState {
  offline: boolean;
  /** idempotency_key -> message_id já processado. Simula a deduplicação do lado do provedor. */
  processedKeys: Map<string, string>;
  /** Próximas N chamadas devolvem 500 mesmo fora do sorteio aleatório (usado para demo determinística). */
  forcedFailures: number;
  /** Quando definido, substitui a `failureRate` padrão (usado para tornar trechos do demo determinísticos). */
  failureRateOverride: number | null;
}

export interface FakeWhatsappOptions {
  /** Probabilidade (0 a 1) de falha simulada (HTTP 500) numa tentativa "nova" (não offline, não duplicada). */
  failureRate?: number;
}

export interface FakeWhatsappInstance {
  router: Router;
  state: FakeWhatsappState;
}

const APPROVED_TEMPLATE_ERROR = 'A conversation must be initiated using an approved template.';

/**
 * Cria uma instância isolada da API falsa do WhatsApp Business.
 * Simula: validação de template aprovado, falha aleatória (~20% por padrão), API offline
 * sob demanda e deduplicação por idempotency_key (1ª camada de proteção contra duplicidade).
 */
export function createFakeWhatsappApi(options: FakeWhatsappOptions = {}): FakeWhatsappInstance {
  const failureRate = options.failureRate ?? 0.2;
  const state: FakeWhatsappState = {
    offline: false,
    processedKeys: new Map(),
    forcedFailures: 0,
    failureRateOverride: null,
  };

  const router = Router();

  router.post('/send', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Mensagens de texto livre nunca são permitidas: uma conversa só pode ser iniciada com template aprovado.
    if (typeof body.mensagem === 'string' && typeof body.template_id !== 'string') {
      return res.status(400).json({ error: APPROVED_TEMPLATE_ERROR });
    }

    if (!isValidPhone(body.para)) {
      return res.status(400).json({ error: 'Campo "para" é obrigatório e deve conter um telefone válido (10-15 dígitos).' });
    }

    if (typeof body.template_id !== 'string' || body.template_id.length === 0) {
      return res.status(400).json({ error: 'Campo "template_id" é obrigatório.' });
    }

    if (body.template_id !== WHATSAPP_TEMPLATE_ID) {
      return res.status(400).json({ error: APPROVED_TEMPLATE_ERROR });
    }

    if (typeof body.variaveis !== 'object' || body.variaveis === null || Array.isArray(body.variaveis)) {
      return res.status(400).json({ error: 'Campo "variaveis" é obrigatório.' });
    }

    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : undefined;

    // Chave já processada: não reenvia, apenas confirma o envio original (deduplicação no provedor).
    if (idempotencyKey && state.processedKeys.has(idempotencyKey)) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message_id: state.processedKeys.get(idempotencyKey),
      });
    }

    if (state.offline) {
      return res.status(503).json({ error: 'API_UNAVAILABLE' });
    }

    if (state.forcedFailures > 0) {
      state.forcedFailures -= 1;
      return res.status(500).json({ error: 'SIMULATED_WHATSAPP_FAILURE' });
    }

    const effectiveFailureRate = state.failureRateOverride ?? failureRate;
    if (Math.random() < effectiveFailureRate) {
      return res.status(500).json({ error: 'SIMULATED_WHATSAPP_FAILURE' });
    }

    const messageId = `msg_${uuidv4()}`;
    if (idempotencyKey) state.processedKeys.set(idempotencyKey, messageId);

    return res.status(200).json({ success: true, duplicate: false, message_id: messageId });
  });

  // Rotas administrativas: existem apenas para permitir que testes e o demo controlem
  // cenários (API offline, falha determinística) sem depender de sorte no Math.random().
  router.post('/admin/offline', (req, res) => {
    state.offline = Boolean((req.body as Record<string, unknown> | undefined)?.offline);
    res.json({ offline: state.offline });
  });

  router.post('/admin/force-failures', (req, res) => {
    const count = Number((req.body as Record<string, unknown> | undefined)?.count ?? 0);
    state.forcedFailures = Number.isFinite(count) && count > 0 ? count : 0;
    res.json({ forcedFailures: state.forcedFailures });
  });

  router.post('/admin/failure-rate', (req, res) => {
    const rate = (req.body as Record<string, unknown> | undefined)?.rate;
    state.failureRateOverride = typeof rate === 'number' && rate >= 0 && rate <= 1 ? rate : null;
    res.json({ failureRateOverride: state.failureRateOverride });
  });

  router.post('/admin/reset', (_req, res) => {
    state.offline = false;
    state.forcedFailures = 0;
    state.failureRateOverride = null;
    state.processedKeys.clear();
    res.json({ ok: true });
  });

  router.get('/admin/status', (_req, res) => {
    res.json({
      offline: state.offline,
      forcedFailures: state.forcedFailures,
      failureRateOverride: state.failureRateOverride,
      processedKeysCount: state.processedKeys.size,
    });
  });

  return { router, state };
}
