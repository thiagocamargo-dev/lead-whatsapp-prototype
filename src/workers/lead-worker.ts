import type { LeadProcessorService } from '../services/lead-processor.service.js';
import { log } from '../utils/logger.js';

/**
 * Worker de polling: a cada `intervalMs`, varre o banco em busca de leads pendentes de
 * qualificação, de envio (incluindo os que ficaram em retry por causa de falha/API offline)
 * e de violações de SLA. Ver README para a justificativa de polling vs. evento.
 */
export class LeadWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly processor: LeadProcessorService,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    log('WORKER_STARTED', { interval_ms: this.intervalMs });
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return; // evita sobreposição se um ciclo demorar mais que o intervalo
    this.running = true;
    try {
      this.processor.sweepQualification();
      await this.processor.sweepWhatsappSend();
      this.processor.sweepSlaViolations();
    } catch (error) {
      log('WORKER_TICK_ERROR', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running = false;
    }
  }
}
