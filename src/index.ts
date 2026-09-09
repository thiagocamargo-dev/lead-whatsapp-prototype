import express, { type Express } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createFakeWhatsappApi, type FakeWhatsappInstance } from './api/fake-whatsapp.js';
import { createLeadsRouter } from './api/leads.js';
import { LeadDatabase, LeadRepository } from './database/database.js';
import { LeadProcessorService } from './services/lead-processor.service.js';
import { WhatsappService } from './services/whatsapp.service.js';
import { computeMetrics } from './services/metrics.service.js';
import { LeadWorker } from './workers/lead-worker.js';
import { log } from './utils/logger.js';

export interface AppContext {
  app: Express;
  database: LeadDatabase;
  repo: LeadRepository;
  processor: LeadProcessorService;
  worker: LeadWorker;
  fakeWhatsapp: FakeWhatsappInstance;
}

// Resolve para <raiz-do-projeto>/public tanto rodando via tsx (src/index.ts) quanto compilado (dist/index.js).
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export interface CreateAppOptions {
  dbPath?: string;
  whatsappFailureRate?: number;
  /** Base URL que o whatsapp.service usará para chamar a API falsa (preenchida após o listen, se necessário). */
  whatsappApiBaseUrl?: string;
  pollIntervalMs?: number;
}

export function createApp(options: CreateAppOptions = {}): AppContext {
  const database = new LeadDatabase(options.dbPath ?? config.dbPath);
  const repo = new LeadRepository(database);

  const fakeWhatsapp = createFakeWhatsappApi({ failureRate: options.whatsappFailureRate ?? config.whatsappFailureRate });
  const whatsapp = new WhatsappService({ baseUrl: options.whatsappApiBaseUrl ?? config.whatsappApiBaseUrl });
  const processor = new LeadProcessorService(repo, whatsapp);
  const worker = new LeadWorker(processor, options.pollIntervalMs ?? config.pollIntervalMs);

  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR)); // dashboard dinâmico (public/index.html) em "/"

  app.use('/fake-whatsapp', fakeWhatsapp.router);
  app.use('/leads', createLeadsRouter(repo));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime_seconds: process.uptime() });
  });

  app.get('/metrics', (_req, res) => {
    res.json(computeMetrics(repo.listAll(), config.slaSeconds));
  });

  return { app, database, repo, processor, worker, fakeWhatsapp };
}

export function startServer(ctx: AppContext, port: number = config.port): Server {
  const server = ctx.app.listen(port, () => {
    log('SERVER_STARTED', { port });
    ctx.worker.start();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ctx = createApp();
  startServer(ctx);

  const shutdown = () => {
    log('SERVER_SHUTTING_DOWN', {});
    ctx.worker.stop();
    ctx.database.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
