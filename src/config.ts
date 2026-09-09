import 'dotenv/config';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envIntList(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return parsed.length > 0 ? parsed : fallback;
}

export const config = {
  port: envInt('PORT', 3000),
  dbPath: process.env.DB_PATH ?? './data/leads.db',
  logPath: process.env.LOG_PATH ?? './logs/application.log',
  pollIntervalMs: envInt('POLL_INTERVAL_MS', 5000),
  slaSeconds: envInt('SLA_SECONDS', 120),
  whatsappFailureRate: envFloat('WHATSAPP_FAILURE_RATE', 0.2),
  maxRetries: envInt('MAX_RETRIES', 4),
  maxTotalAttempts: envInt('MAX_TOTAL_ATTEMPTS', 8),
  retryDelaysMs: envIntList('RETRY_DELAYS_MS', [0, 2000, 5000, 10000]),
  qualificationMinScore: envInt('QUALIFICATION_MIN_SCORE', 70),
  whatsappApiBaseUrl: process.env.WHATSAPP_API_BASE_URL ?? 'http://localhost:3000',
  whatsappHttpTimeoutMs: envInt('WHATSAPP_HTTP_TIMEOUT_MS', 5000),
} as const;

export type AppConfig = typeof config;
