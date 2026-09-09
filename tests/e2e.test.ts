import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeWhatsappApi, type FakeWhatsappInstance } from '../src/api/fake-whatsapp.js';
import { LeadDatabase, LeadRepository } from '../src/database/database.js';
import { LeadProcessorService } from '../src/services/lead-processor.service.js';
import { WhatsappService } from '../src/services/whatsapp.service.js';
import type { CreateLeadInput } from '../src/models/lead.js';

const QUALIFIED_LEAD: CreateLeadInput = {
  nome: 'João Silva',
  telefone: '5511988990001',
  empresa: 'Acme',
  cargo: 'CEO',
  faturamento_anual: '1M-5M',
  numero_de_funcionarios: '51-200',
  score: 92,
  status: 'new',
};

const REJECTED_LEAD: CreateLeadInput = {
  nome: 'Estagiário Teste',
  telefone: '5511988990002',
  empresa: 'Micro Empresa',
  cargo: 'Estagiário',
  faturamento_anual: '<500K',
  numero_de_funcionarios: '1-10',
  score: 20,
  status: 'new',
};

describe('E2E - pipeline completo (lead -> qualificação -> WhatsApp -> SLA)', () => {
  let server: Server;
  let fakeWhatsapp: FakeWhatsappInstance;
  let database: LeadDatabase;
  let repo: LeadRepository;
  let processor: LeadProcessorService;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    fakeWhatsapp = createFakeWhatsappApi({ failureRate: 0 }); // determinístico: sem falha aleatória neste teste
    app.use('/fake-whatsapp', fakeWhatsapp.router);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    const whatsapp = new WhatsappService({ baseUrl: `http://localhost:${port}`, timeoutMs: 2000 });
    database = new LeadDatabase(':memory:');
    repo = new LeadRepository(database);
    processor = new LeadProcessorService(repo, whatsapp);
  });

  afterAll(() => {
    server.close();
    database.close();
  });

  beforeEach(() => {
    fakeWhatsapp.state.offline = false;
    fakeWhatsapp.state.forcedFailures = 0;
    fakeWhatsapp.state.failureRateOverride = null;
    fakeWhatsapp.state.processedKeys.clear();
  });

  it('qualifica CEO com score alto e rejeita estagiário com score baixo', () => {
    const good = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-good', criado_em: new Date().toISOString() });
    const bad = repo.create({ ...REJECTED_LEAD, id: 'e2e-bad', criado_em: new Date().toISOString() });

    processor.sweepQualification();

    expect(repo.getById(good.id)!.status).toBe('qualificado');
    expect(repo.getById(good.id)!.qualificado_em).not.toBeNull();
    expect(repo.getById(bad.id)!.status).toBe('new');
    expect(repo.getById(bad.id)!.qualificado_em).toBeNull();
  });

  it('envia a mensagem, calcula elapsed a partir de qualificado_em e passa no SLA', async () => {
    const lead = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-sla-pass', criado_em: new Date().toISOString() });
    processor.sweepQualification();

    const qualified = repo.getById(lead.id)!;
    expect(qualified.qualificado_em).not.toBeNull();

    const sent = await processor.sendForLead(qualified);

    expect(sent.whatsapp_status).toBe('enviado');
    expect(sent.whatsapp_message_id).toMatch(/^msg_/);
    const elapsed = (new Date(sent.enviado_em!).getTime() - new Date(sent.qualificado_em!).getTime()) / 1000;
    expect(elapsed).toBeLessThan(120);
  });

  it('sobrevive a falhas reais (HTTP 500) da API falsa e envia sem duplicar', async () => {
    // Este teste NÃO usa mocks: faz chamadas HTTP de verdade contra a API falsa do
    // WhatsApp, forçando exatamente 2 respostas 500 (o mesmo `SIMULATED_WHATSAPP_FAILURE`
    // que a falha aleatória de ~20% produziria) antes da 3ª tentativa suceder de verdade.
    // Prova, ponta a ponta, que "falha e tenta de novo" nunca produz uma segunda mensagem.
    const lead = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-real-500-retry', criado_em: new Date().toISOString() });
    processor.sweepQualification();
    const qualified = repo.getById(lead.id)!;

    fakeWhatsapp.state.forcedFailures = 2; // as 2 primeiras chamadas HTTP recebem 500 de verdade

    const sent = await processor.sendForLead(qualified);

    expect(sent.whatsapp_status).toBe('enviado');
    expect(sent.tentativas_envio).toBe(3); // 2 falhas reais + 1 sucesso real
    expect(sent.ultimo_erro).toBeNull();
    expect(repo.countMessagesForLead(lead.id)).toBe(1); // nenhuma duplicidade apesar das falhas
    expect(fakeWhatsapp.state.forcedFailures).toBe(0); // confirma que as 2 falhas realmente aconteceram
  }, 15_000);

  it('não duplica mensagem ao reprocessar o mesmo lead já enviado', async () => {
    const lead = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-dup', criado_em: new Date().toISOString() });
    processor.sweepQualification();
    const qualified = repo.getById(lead.id)!;

    const first = await processor.sendForLead(qualified);
    expect(repo.countMessagesForLead(lead.id)).toBe(1);

    const second = await processor.sendForLead(first);
    expect(repo.countMessagesForLead(lead.id)).toBe(1); // continua 1, não virou 2
    expect(second.whatsapp_message_id).toBe(first.whatsapp_message_id);
  });

  it('mantém o lead pendente durante indisponibilidade da API e recupera quando ela volta', async () => {
    const lead = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-offline', criado_em: new Date().toISOString() });
    processor.sweepQualification();
    const qualified = repo.getById(lead.id)!;

    fakeWhatsapp.state.offline = true;
    const afterOutage = await processor.sendForLead(qualified);

    // Esgotou as tentativas locais deste ciclo, mas o lead continua no banco, pronto para retomar.
    expect(afterOutage.whatsapp_status).toBe('retrying');
    expect(afterOutage.status).toBe('qualificado');
    expect(afterOutage.tentativas_envio).toBeGreaterThan(0);

    fakeWhatsapp.state.offline = false;
    const recovered = await processor.sendForLead(afterOutage);

    expect(recovered.whatsapp_status).toBe('enviado');
    expect(recovered.whatsapp_message_id).toBeTruthy();
  }, 30_000);

  it('detecta violação de SLA para lead qualificado há mais de 120s sem envio', () => {
    const lead = repo.create({ ...QUALIFIED_LEAD, id: 'e2e-sla-fail', criado_em: new Date().toISOString() });
    processor.sweepQualification();

    const longAgo = new Date(Date.now() - 130_000).toISOString();
    repo.update(lead.id, { qualificado_em: longAgo });

    const violations = processor.sweepSlaViolations();
    expect(violations.some((v) => v.id === lead.id)).toBe(true);

    // Segunda varredura não deve relatar o mesmo lead de novo (já foi marcado como logado).
    const secondPass = processor.sweepSlaViolations();
    expect(secondPass.some((v) => v.id === lead.id)).toBe(false);
  });
});
