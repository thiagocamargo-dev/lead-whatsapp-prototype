export interface RetryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  error?: string;
  nextDelayMs?: number;
}

export interface RetryOptions<T> {
  /** Atraso (ms) antes de cada tentativa. O índice 0 é a 1ª tentativa (normalmente 0 = imediata). */
  delaysMs: number[];
  /** Chamado antes de cada tentativa. */
  onAttempt?: (info: RetryAttemptInfo) => void;
  /** Chamado quando uma tentativa falha (mas ainda haverá outra). */
  onRetryableError?: (info: RetryAttemptInfo) => void;
  /** Decide se um erro é elegível a retry. Por padrão, todo erro é retryable. */
  isRetryable?: (error: unknown) => boolean;
  fn: (attempt: number) => Promise<T>;
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  attempts: number;
  lastError?: unknown;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa `fn` com backoff configurável. `delaysMs` define o número máximo de tentativas
 * (length do array) e o atraso antes de cada uma delas.
 */
export async function retryWithBackoff<T>(options: RetryOptions<T>): Promise<RetryResult<T>> {
  const { delaysMs, fn, onAttempt, onRetryableError, isRetryable = () => true } = options;
  const maxAttempts = delaysMs.length;
  let lastError: unknown;

  for (let i = 0; i < maxAttempts; i++) {
    const attempt = i + 1;
    const delay = delaysMs[i] ?? 0;
    await sleep(delay);

    onAttempt?.({ attempt, maxAttempts });

    try {
      const value = await fn(attempt);
      return { success: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      const hasMoreAttempts = attempt < maxAttempts;

      if (!retryable || !hasMoreAttempts) {
        return { success: false, attempts: attempt, lastError };
      }

      onRetryableError?.({
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
        nextDelayMs: delaysMs[i + 1] ?? 0,
      });
    }
  }

  return { success: false, attempts: maxAttempts, lastError };
}
