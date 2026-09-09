import { describe, expect, it } from 'vitest';
import { evaluateQualification, isDecisionMaker } from '../src/services/qualification.service.js';

describe('qualification.service', () => {
  it('qualifica CEO com score alto e empresa relevante', () => {
    const result = evaluateQualification({
      score: 85,
      cargo: 'CEO',
      faturamento_anual: '1M-5M',
      numero_de_funcionarios: '51-200',
    });
    expect(result.qualified).toBe(true);
    expect(result.scoreOk).toBe(true);
    expect(result.cargoOk).toBe(true);
  });

  it('não qualifica estagiário com score baixo', () => {
    const result = evaluateQualification({
      score: 25,
      cargo: 'Estagiário',
      faturamento_anual: '<500K',
      numero_de_funcionarios: '1-10',
    });
    expect(result.qualified).toBe(false);
    expect(result.scoreOk).toBe(false);
    expect(result.cargoOk).toBe(false);
  });

  it('não qualifica quando o score é alto mas não há nenhum sinal adicional', () => {
    const result = evaluateQualification({
      score: 90,
      cargo: 'Analista Júnior',
      faturamento_anual: '<500K',
      numero_de_funcionarios: '1-10',
    });
    expect(result.qualified).toBe(false);
    expect(result.scoreOk).toBe(true);
    expect(result.cargoOk).toBe(false);
    expect(result.faturamentoOk).toBe(false);
    expect(result.funcionariosOk).toBe(false);
  });

  it('não qualifica cargo decisório se o score estiver abaixo do mínimo', () => {
    const result = evaluateQualification({
      score: 60,
      cargo: 'Founder',
      faturamento_anual: '1M-5M',
      numero_de_funcionarios: '51-200',
    });
    expect(result.qualified).toBe(false);
    expect(result.scoreOk).toBe(false);
  });

  it('qualifica via faturamento/tamanho da empresa mesmo sem cargo decisório', () => {
    const result = evaluateQualification({
      score: 75,
      cargo: 'Coordenadora de Marketing',
      faturamento_anual: '20M+',
      numero_de_funcionarios: '500+',
    });
    expect(result.qualified).toBe(true);
    expect(result.cargoOk).toBe(false);
    expect(result.faturamentoOk).toBe(true);
    expect(result.funcionariosOk).toBe(true);
  });

  it('reconhece variações de cargos decisórios (com acentos e maiúsculas)', () => {
    expect(isDecisionMaker('Diretora Comercial')).toBe(true);
    expect(isDecisionMaker('sócio-fundador')).toBe(true);
    expect(isDecisionMaker('VP de Operações')).toBe(true);
    expect(isDecisionMaker('Analista de Produto')).toBe(false);
  });
});
