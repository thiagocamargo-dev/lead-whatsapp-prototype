import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

type LogFields = Record<string, string | number | boolean | null | undefined>;

let logFilePath = config.logPath;
let stream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream {
  if (stream) return stream;
  const dir = path.dirname(logFilePath);
  fs.mkdirSync(dir, { recursive: true });
  stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  return stream;
}

/** Permite redirecionar o log para outro arquivo (usado por testes/demo isolados). */
export function setLogFilePath(newPath: string): void {
  logFilePath = newPath;
  if (stream) {
    stream.end();
    stream = null;
  }
}

/** Mascara um telefone mantendo os 6 primeiros e os 4 últimos dígitos visíveis. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 10) return '*'.repeat(digits.length);
  return `${digits.slice(0, 6)}****${digits.slice(-4)}`;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Logger estruturado por evento, no formato:
 * [HH:MM:SS] EVENT_NAME
 * campo=valor
 * campo=valor
 */
export function log(event: string, fields: LogFields = {}): void {
  const lines = [`[${timestamp()}] ${event}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}=${value ?? 'null'}`);
  }
  const block = lines.join('\n') + '\n\n';

  process.stdout.write(block);
  try {
    ensureStream().write(block);
  } catch {
    // Em ambiente de teste o diretório pode não existir ainda; não deve derrubar o processo.
  }
}

export const logger = { log, maskPhone, setLogFilePath };
