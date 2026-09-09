import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeWhatsappApi } from '../src/api/fake-whatsapp.js';
import { LeadDatabase, LeadRepository } from '../src/database/database.js';

interface FakeWhatsappResponse {
  error?: string;
  success?: boolean;
  duplicate?: boolean;
  message_id?: string;
}

async function readJson(res: Response): Promise<FakeWhatsappResponse> {
  return (await res.json()) as FakeWhatsappResponse;
}

describe('Idempotência - camada 1 (API falsa do WhatsApp)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const { router } = createFakeWhatsappApi({ failureRate: 0 });
    app.use('/fake-whatsapp', router);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('rejeita mensagem de texto livre sem template', async () => {
    const res = await fetch(`${baseUrl}/fake-whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ para: '5511999998888', mensagem: 'Olá João, tudo bem?' }),
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toMatch(/approved template/i);
  });

  it('rejeita template_id não aprovado', async () => {
    const res = await fetch(`${baseUrl}/fake-whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ para: '5511999998888', template_id: 'promocao_livre', variaveis: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('mesma idempotency_key enviada duas vezes gera apenas 1 mensagem', async () => {
    const payload = {
      para: '5511999997777',
      template_id: 'boas_vindas_lead',
      variaveis: { nome: 'Maria', empresa: 'Acme' },
      idempotency_key: 'whatsapp:lead:test-lead-1:boas_vindas_lead',
    };

    const first = await fetch(`${baseUrl}/fake-whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const firstBody = await readJson(first);
    expect(first.status).toBe(200);
    expect(firstBody.duplicate).toBe(false);

    const second = await fetch(`${baseUrl}/fake-whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const secondBody = await readJson(second);
    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.message_id).toBe(firstBody.message_id);
  });
});

describe('Idempotência - camada 2 (UNIQUE constraint no banco)', () => {
  it('recordMessageOnce impede uma segunda linha para o mesmo (lead_id, template_id)', () => {
    const database = new LeadDatabase(':memory:');
    const repo = new LeadRepository(database);

    const lead = repo.create({
      id: 'lead-db-test',
      nome: 'Carlos',
      telefone: '5511988887777',
      empresa: 'Acme',
      cargo: 'CEO',
      faturamento_anual: '1M-5M',
      numero_de_funcionarios: '51-200',
      score: 90,
      status: 'new',
      criado_em: new Date().toISOString(),
    });

    const first = repo.recordMessageOnce({
      id: 'msg-row-1',
      leadId: lead.id,
      templateId: 'boas_vindas_lead',
      messageId: 'msg_abc',
      idempotencyKey: `whatsapp:lead:${lead.id}:boas_vindas_lead`,
      sentAt: new Date().toISOString(),
    });

    const second = repo.recordMessageOnce({
      id: 'msg-row-2',
      leadId: lead.id,
      templateId: 'boas_vindas_lead',
      messageId: 'msg_xyz_diferente',
      idempotencyKey: `whatsapp:lead:${lead.id}:boas_vindas_lead`,
      sentAt: new Date().toISOString(),
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(repo.countMessagesForLead(lead.id)).toBe(1);

    database.close();
  });
});
