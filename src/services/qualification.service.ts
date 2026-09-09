import { config } from '../config.js';
import {
  DECISION_MAKER_ROLES,
  FATURAMENTO_BANDS,
  FUNCIONARIOS_BANDS,
  type FaturamentoBand,
  type FuncionariosBand,
  type Lead,
} from '../models/lead.js';

export interface QualificationResult {
  qualified: boolean;
  scoreOk: boolean;
  cargoOk: boolean;
  faturamentoOk: boolean;
  funcionariosOk: boolean;
  reasons: string[];
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS, '').toLowerCase().trim();
}

export function isDecisionMaker(cargo: string): boolean {
  const normalized = normalize(cargo);
  return DECISION_MAKER_ROLES.some((role) => normalized.includes(role));
}

const FATURAMENTO_QUALIFYING_INDEX = FATURAMENTO_BANDS.indexOf('1M-5M');
const FUNCIONARIOS_QUALIFYING_INDEX = FUNCIONARIOS_BANDS.indexOf('51-200');

export function faturamentoMeetsThreshold(band: FaturamentoBand): boolean {
  return FATURAMENTO_BANDS.indexOf(band) >= FATURAMENTO_QUALIFYING_INDEX;
}

export function funcionariosMeetsThreshold(band: FuncionariosBand): boolean {
  return FUNCIONARIOS_BANDS.indexOf(band) >= FUNCIONARIOS_QUALIFYING_INDEX;
}

/**
 * Regra de qualificação: score >= mínimo E pelo menos um sinal de "capacidade de compra"
 * (cargo decisório, faturamento >= 1M ou empresa com >= 51 funcionários).
 *
 * O score sozinho mede engajamento/fit comportamental, não capacidade de compra — por isso
 * exigimos um segundo sinal. Ver README para a justificativa completa e os trade-offs
 * (falsos positivos/negativos) dessa regra.
 */
export function evaluateQualification(lead: Pick<Lead, 'score' | 'cargo' | 'faturamento_anual' | 'numero_de_funcionarios'>): QualificationResult {
  const scoreOk = lead.score >= config.qualificationMinScore;
  const cargoOk = isDecisionMaker(lead.cargo);
  const faturamentoOk = faturamentoMeetsThreshold(lead.faturamento_anual);
  const funcionariosOk = funcionariosMeetsThreshold(lead.numero_de_funcionarios);

  const reasons: string[] = [];
  if (cargoOk) reasons.push('cargo decisório');
  if (faturamentoOk) reasons.push('faturamento >= 1M');
  if (funcionariosOk) reasons.push('empresa >= 51 funcionários');

  return {
    qualified: scoreOk && (cargoOk || faturamentoOk || funcionariosOk),
    scoreOk,
    cargoOk,
    faturamentoOk,
    funcionariosOk,
    reasons,
  };
}
