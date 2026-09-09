import { describe, expect, it } from 'vitest';
import { SEED_LEADS } from '../src/database/seed-data.js';
import { evaluateQualification } from '../src/services/qualification.service.js';

// Este arquivo prova, de forma automatizada, que o dataset gerado por `npm run seed`
// (30-50 leads variados, com "leads ruins" propositais) realmente é filtrado corretamente
// pela regra de qualificação — não é só algo visível "de olho" rodando `npm run demo`.

describe('Dataset gerado (seed-data.ts)', () => {
  it('gera entre 30 e 50 leads', () => {
    expect(SEED_LEADS.length).toBeGreaterThanOrEqual(30);
    expect(SEED_LEADS.length).toBeLessThanOrEqual(50);
  });

  it('varia score, cargo e status entre os leads', () => {
    const scores = new Set(SEED_LEADS.map((l) => l.score));
    const cargos = new Set(SEED_LEADS.map((l) => l.cargo));
    const statuses = new Set(SEED_LEADS.map((l) => l.status));

    expect(scores.size).toBeGreaterThan(10); // scores bem espalhados, não repetidos
    expect(cargos.size).toBeGreaterThan(10); // cargos variados
    expect(statuses).toEqual(new Set(['new', 'draft'])); // os dois status pedidos aparecem
  });

  it('inclui propositalmente leads "ruins" (score baixo + cargo júnior)', () => {
    const JUNIOR_KEYWORDS = ['estagi', 'assistente', 'auxiliar', 'recepcionista', 'júnior', 'junior'];
    const badLeads = SEED_LEADS.filter(
      (l) => l.score < 50 && JUNIOR_KEYWORDS.some((kw) => l.cargo.toLowerCase().includes(kw)),
    );
    // pelo menos alguns leads claramente "ruins" (score baixo E cargo júnior) devem existir
    expect(badLeads.length).toBeGreaterThanOrEqual(5);
  });

  it('nenhum lead com score < 50 é qualificado, mesmo com cargo/empresa favoráveis', () => {
    const lowScoreLeads = SEED_LEADS.filter((l) => l.score < 50);
    expect(lowScoreLeads.length).toBeGreaterThan(0);

    for (const lead of lowScoreLeads) {
      const result = evaluateQualification(lead);
      expect(result.qualified).toBe(false);
    }
  });

  it('leads júniores/estagiários nunca qualificam, mesmo quando o score é alto', () => {
    // Felipe Araújo (Analista Júnior, score 89) e Natália Barros (Estagiária, score 91):
    // score alto sozinho não basta sem cargo decisório/faturamento/porte de empresa.
    const juniorHighScore = SEED_LEADS.filter(
      (l) => l.score >= 85 && /júnior|estagi/i.test(l.cargo) && l.faturamento_anual === '<500K',
    );
    expect(juniorHighScore.length).toBeGreaterThanOrEqual(2);

    for (const lead of juniorHighScore) {
      expect(evaluateQualification(lead).qualified).toBe(false);
    }
  });

  it('decisores com score alto e empresa relevante qualificam', () => {
    const goodOnes = SEED_LEADS.filter((l) => l.nome === 'Marcelo Andrade' || l.nome === 'Ricardo Monteiro');
    expect(goodOnes.length).toBe(2);

    for (const lead of goodOnes) {
      expect(evaluateQualification(lead).qualified).toBe(true);
    }
  });

  it('a regra filtra o lote inteiro na proporção documentada no README (16 qualificados / 20 rejeitados)', () => {
    const evaluated = SEED_LEADS.filter((l) => l.status !== 'draft');
    const qualified = evaluated.filter((l) => evaluateQualification(l).qualified);
    const rejected = evaluated.filter((l) => !evaluateQualification(l).qualified);

    expect(evaluated.length).toBe(36);
    expect(qualified.length).toBe(16);
    expect(rejected.length).toBe(20);
  });
});
