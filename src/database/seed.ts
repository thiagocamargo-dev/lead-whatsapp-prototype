import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { evaluateQualification } from '../services/qualification.service.js';
import { LeadDatabase, LeadRepository } from './database.js';
import { SEED_LEADS } from './seed-data.js';

/** Repopula o banco com os 40 leads determinísticos usados no desafio (apaga o banco anterior). */
export function seedDatabase(dbPath: string = config.dbPath): void {
  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
    for (const suffix of ['-journal', '-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);
    }
  }

  const database = new LeadDatabase(dbPath);
  const repo = new LeadRepository(database);
  const now = new Date();

  SEED_LEADS.forEach((input, index) => {
    // Espalha criado_em nos últimos dias para parecer uma base real (não afeta o SLA, que usa qualificado_em).
    const criadoEm = new Date(now.getTime() - (SEED_LEADS.length - index) * 3600_000).toISOString();
    repo.create({ ...input, id: randomUUID(), criado_em: criadoEm });
  });

  database.close();
}

function printPreview(): void {
  const draft = SEED_LEADS.filter((l) => l.status === 'draft');
  const evaluated = SEED_LEADS.filter((l) => l.status !== 'draft');
  const qualified = evaluated.filter((l) => evaluateQualification(l).qualified);
  const rejected = evaluated.filter((l) => !evaluateQualification(l).qualified);

  console.log(`Total: ${SEED_LEADS.length}`);
  console.log(`Draft (fora do funil): ${draft.length}`);
  console.log(`Avaliados (status=new): ${evaluated.length}`);
  console.log(`  Qualificados (prévia): ${qualified.length}`);
  console.log(`  Rejeitados (prévia): ${rejected.length}`);
  console.log('\n(Esta é uma prévia estática da regra de qualificação. Os campos qualificado_em/');
  console.log('status no banco só são preenchidos quando o worker roda de fato — via `npm run dev` ou `npm run demo`.)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase();
  console.log(`Banco populado em ${config.dbPath} com ${SEED_LEADS.length} leads.\n`);
  printPreview();
}
