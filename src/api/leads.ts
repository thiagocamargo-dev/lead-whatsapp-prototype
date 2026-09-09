import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { LeadRepository } from '../database/database.js';
import { isValidFaturamentoBand, isValidFuncionariosBand } from '../database/database.js';
import { log, maskPhone } from '../utils/logger.js';
import { isValidPhone } from '../utils/validation.js';

/** Formulário de criação de lead (seção 1 do desafio: "um lead é criado por meio de um formulário"). */
export function createLeadsRouter(repo: LeadRepository): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    const empresa = typeof body.empresa === 'string' ? body.empresa.trim() : '';
    const cargo = typeof body.cargo === 'string' ? body.cargo.trim() : '';
    const telefone = typeof body.telefone === 'string' ? body.telefone.trim() : '';
    const score = Number(body.score);

    if (!nome) return res.status(400).json({ error: 'Campo "nome" é obrigatório.' });
    if (!empresa) return res.status(400).json({ error: 'Campo "empresa" é obrigatório.' });
    if (!cargo) return res.status(400).json({ error: 'Campo "cargo" é obrigatório.' });
    if (!isValidPhone(telefone)) {
      return res.status(400).json({ error: 'Campo "telefone" é obrigatório e deve conter um telefone válido (10-15 dígitos).' });
    }
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'Campo "score" é obrigatório e deve estar entre 0 e 100.' });
    }
    if (!isValidFaturamentoBand(body.faturamento_anual)) {
      return res.status(400).json({ error: 'Campo "faturamento_anual" inválido.' });
    }
    if (!isValidFuncionariosBand(body.numero_de_funcionarios)) {
      return res.status(400).json({ error: 'Campo "numero_de_funcionarios" inválido.' });
    }
    const status = body.status === 'draft' ? 'draft' : 'new';

    const lead = repo.create({
      id: randomUUID(),
      nome,
      telefone,
      empresa,
      cargo,
      faturamento_anual: body.faturamento_anual,
      numero_de_funcionarios: body.numero_de_funcionarios,
      score,
      status,
      criado_em: new Date().toISOString(),
    });

    log('LEAD_CREATED', { lead_id: lead.id, telefone: maskPhone(lead.telefone), status: lead.status });
    return res.status(201).json(lead);
  });

  router.get('/', (_req, res) => {
    res.json(repo.listAll());
  });

  router.get('/:id', (req, res) => {
    const lead = repo.getById(req.params.id as string);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    return res.json(lead);
  });

  return router;
}
