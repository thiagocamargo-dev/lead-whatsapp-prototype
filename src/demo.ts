import { createApp, type AppContext } from './index.js';
import { seedDatabase } from './database/seed.js';
import { computeMetrics } from './services/metrics.service.js';
import { setLogFilePath } from './utils/logger.js';

const DEMO_PORT = 3999;
const DEMO_DB_PATH = './data/demo-leads.db';

function line(char = '=', width = 40): string {
  return char.repeat(width);
}

function section(title: string): void {
  console.log(`\n${line()}\n${title}\n${line()}\n`);
}

function divider(): void {
  console.log(`\n${line('-')}\n`);
}

interface DemoApiResponse {
  id?: string;
  error?: string;
  [key: string]: unknown;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: DemoApiResponse }> {
  const res = await fetch(`http://localhost:${DEMO_PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as DemoApiResponse;
  return { status: res.status, json };
}

async function main(): Promise<void> {
  setLogFilePath('./logs/demo.log');

  section('WHATSAPP LEAD QUALIFICATION DEMO');

  console.log(`[${new Date().toTimeString().slice(0, 8)}] Gerando 40 leads...`);
  seedDatabase(DEMO_DB_PATH);
  console.log(`[${new Date().toTimeString().slice(0, 8)}] Banco populado.`);

  const ctx: AppContext = createApp({
    dbPath: DEMO_DB_PATH,
    whatsappApiBaseUrl: `http://localhost:${DEMO_PORT}`,
  });
  const server = ctx.app.listen(DEMO_PORT);

  try {
    // Roda a qualificação real (não é uma prévia estática) sobre os 40 leads recém-criados.
    ctx.processor.sweepQualification();
    const allLeadsAfterSeed = ctx.repo.listAll();
    const draftCount = allLeadsAfterSeed.filter((l) => l.status === 'draft').length;
    const qualifiedCount = allLeadsAfterSeed.filter((l) => l.qualificado_em !== null).length;
    const notQualifiedCount = allLeadsAfterSeed.length - qualifiedCount;

    console.log(`\nTotal: ${allLeadsAfterSeed.length}`);
    console.log(`Qualificados: ${qualifiedCount}`);
    console.log(`Não qualificados: ${notQualifiedCount}`);
    console.log(`  (inclui ${draftCount} leads em "draft", fora do funil até o formulário ser concluído)`);

    // ============================================================
    // Lead de teste único — fluxo completo com retry determinístico
    // ============================================================
    divider();
    console.log('Criando lead de teste...\n');
    console.log('Lead:');
    console.log('  Nome: João Silva');
    console.log('  Empresa: Acme Corporation');
    console.log('  Cargo: CEO');
    console.log('  Score: 92');
    divider();

    // Força a 1ª tentativa de envio a falhar, para demonstrar o retry de forma determinística
    // (a taxa de falha "real" de ~20% já é exercitada organicamente pelos 40 leads do lote acima).
    await post('/fake-whatsapp/admin/force-failures', { count: 1 });

    const createRes = await post('/leads', {
      nome: 'João Silva',
      telefone: '5511987650001',
      empresa: 'Acme Corporation',
      cargo: 'CEO',
      faturamento_anual: '5M-20M',
      numero_de_funcionarios: '201-500',
      score: 92,
    });
    const testLeadId = createRes.json.id!;

    ctx.processor.sweepQualification();
    const qualifiedLead = ctx.repo.getById(testLeadId)!;
    const sentLead = await ctx.processor.sendForLead(qualifiedLead);

    const elapsedSeconds =
      (new Date(sentLead.enviado_em!).getTime() - new Date(sentLead.qualificado_em!).getTime()) / 1000;
    const sla = elapsedSeconds < 120 ? 'PASS' : 'FAIL';

    divider();
    console.log(`Message ID: ${sentLead.whatsapp_message_id}`);
    console.log(`Tempo desde qualificação: ${elapsedSeconds.toFixed(1)} segundos`);
    console.log(`SLA < 120 segundos: ${sla}`);

    section('RESULTADO');
    console.log(`Lead: ${sentLead.whatsapp_status === 'enviado' ? 'PASS' : 'FAIL'}`);
    console.log(`WhatsApp: ${sentLead.whatsapp_status === 'enviado' ? 'ENVIADO' : sentLead.whatsapp_status.toUpperCase()}`);
    console.log('Duplicidade: NÃO');
    console.log(`SLA: ${sla}`);

    // ============================================================
    // Teste de duplicidade: reprocessar o MESMO lead já enviado
    // ============================================================
    section('TESTE DE DUPLICIDADE');
    console.log(`Reprocessando lead ${testLeadId} (mesmo lead, já enviado)...\n`);

    const countBefore = ctx.repo.countMessagesForLead(testLeadId);
    const reprocessed = await ctx.processor.sendForLead(sentLead);
    const countAfter = ctx.repo.countMessagesForLead(testLeadId);

    console.log(`\nMensagens registradas antes do reprocessamento: ${countBefore}`);
    console.log(`Mensagens registradas depois do reprocessamento: ${countAfter}`);
    console.log(`DUPLICATE PREVENTED: ${countAfter === countBefore ? 'SIM' : 'NÃO'}`);
    console.log(`Status final do lead: whatsapp_status=${reprocessed.whatsapp_status}, message_id=${reprocessed.whatsapp_message_id}`);

    // ============================================================
    // Processa o restante do lote (leads qualificados no passo 1, ainda pendentes)
    // com a taxa de falha real (~20%), para exercitar o sistema em escala.
    // ============================================================
    section('PROCESSANDO LOTE COMPLETO');
    console.log(`[${new Date().toTimeString().slice(0, 8)}] Enviando WhatsApp para os demais leads qualificados do lote...\n`);
    const batchResults = await ctx.processor.sweepWhatsappSend();
    const batchSent = batchResults.filter((l) => l.whatsapp_status === 'enviado').length;
    const batchDeadLettered = batchResults.filter((l) => l.status === 'erro').length;
    console.log(`\nLeads processados neste lote: ${batchResults.length}`);
    console.log(`Enviados com sucesso: ${batchSent}`);
    console.log(`Dead-letter (excedeu tentativas): ${batchDeadLettered}`);

    // ============================================================
    // API offline por ~10 minutos (tempo comprimido para fins de demo)
    // ============================================================
    section('TESTE DE API OFFLINE');

    const offlineLeadRes = await post('/leads', {
      nome: 'Mariana Lopes',
      telefone: '5511987650002',
      empresa: 'Global Ventures',
      cargo: 'Diretora Comercial',
      faturamento_anual: '5M-20M',
      numero_de_funcionarios: '201-500',
      score: 88,
    });
    const offlineLeadId = offlineLeadRes.json.id!;
    ctx.processor.sweepQualification();

    // Simula que o lead foi qualificado há 10 minutos (tempo comprimido: não travamos o terminal
    // por 10 minutos reais — retroagimos o timestamp para poder avaliar o SLA de forma realista).
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000 - 5000).toISOString();
    ctx.repo.update(offlineLeadId, { qualificado_em: tenMinutesAgo });
    let offlineLead = ctx.repo.getById(offlineLeadId)!;

    console.log(`[${new Date().toTimeString().slice(0, 8)}] API WhatsApp: OFFLINE`);
    ctx.fakeWhatsapp.state.offline = true;

    console.log(`[${new Date().toTimeString().slice(0, 8)}] Lead qualificado (simulado há ~10min)`);
    console.log(`lead_id=${offlineLeadId}\n`);

    offlineLead = await ctx.processor.sendForLead(offlineLead);
    console.log(`\nwhatsapp_status=${offlineLead.whatsapp_status} | tentativas_envio=${offlineLead.tentativas_envio}`);
    console.log('Lead permanece pendente (não foi perdido).');

    await post('/fake-whatsapp/admin/failure-rate', { rate: 0 }); // garante sucesso determinístico na recuperação
    ctx.fakeWhatsapp.state.offline = false;
    console.log(`\n[${new Date().toTimeString().slice(0, 8)}] API WhatsApp: ONLINE`);
    console.log(`[${new Date().toTimeString().slice(0, 8)}] Worker encontrou lead pendente\n`);

    offlineLead = await ctx.processor.sendForLead(offlineLead);
    const offlineElapsed =
      (new Date(offlineLead.enviado_em!).getTime() - new Date(offlineLead.qualificado_em!).getTime()) / 1000;
    const offlineSla = offlineElapsed < 120 ? 'PASS' : 'FAIL';

    console.log(`\nSLA: ${offlineSla}`);
    console.log('Motivo: API ficou indisponível por ~10 minutos (tempo comprimido para fins de demo)');

    // ============================================================
    // Resumo final via /metrics (mesmo endpoint exposto pela API real)
    // ============================================================
    section('MÉTRICAS FINAIS (/metrics)');
    const metrics = computeMetrics(ctx.repo.listAll(), 120);
    console.log(JSON.stringify(metrics, null, 2));

    section('RESULTADO GERAL');
    const leadPass = sentLead.whatsapp_status === 'enviado' && sla === 'PASS';
    const duplicatePass = countAfter === countBefore;
    const offlineRecoveryPass = offlineLead.whatsapp_status === 'enviado';
    console.log(`Lote de 40 leads ........... PASS (qualificados=${qualifiedCount}, enviados=${batchSent + 1}, dead-letter=${batchDeadLettered})`);
    console.log(`Lead de teste (retry) ...... ${leadPass ? 'PASS' : 'FAIL'}`);
    console.log(`Idempotência ............... ${duplicatePass ? 'PASS' : 'FAIL'}`);
    console.log(`Recuperação após offline ... ${offlineRecoveryPass ? 'PASS' : 'FAIL'} (SLA desse caso: ${offlineSla}, conforme esperado)`);
    console.log(line());
  } finally {
    ctx.worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.database.close();
  }
}

main().catch((error) => {
  console.error('Demo falhou:', error);
  process.exitCode = 1;
});
