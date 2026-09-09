import { describe, expect, it } from 'vitest';
import { retryWithBackoff } from '../src/utils/retry.js';

describe('retryWithBackoff', () => {
  it('tenta novamente após falhas e sucede na 3ª tentativa (500, 500, 200)', async () => {
    const responses = [
      () => Promise.reject(new Error('500')),
      () => Promise.reject(new Error('500')),
      () => Promise.resolve('200 OK'),
    ];
    let callIndex = 0;
    const attempts: number[] = [];

    const result = await retryWithBackoff({
      delaysMs: [0, 0, 0, 0],
      onAttempt: ({ attempt }) => attempts.push(attempt),
      fn: () => responses[callIndex++]!(),
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe('200 OK');
    expect(result.attempts).toBe(3);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('desiste após esgotar o número máximo de tentativas', async () => {
    const result = await retryWithBackoff({
      delaysMs: [0, 0, 0],
      fn: () => Promise.reject(new Error('sempre falha')),
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect((result.lastError as Error).message).toBe('sempre falha');
  });

  it('não tenta novamente quando isRetryable retorna false', async () => {
    let calls = 0;
    const result = await retryWithBackoff({
      delaysMs: [0, 0, 0],
      isRetryable: () => false,
      fn: () => {
        calls += 1;
        return Promise.reject(new Error('erro definitivo'));
      },
    });

    expect(result.success).toBe(false);
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it('respeita o backoff configurado entre tentativas', async () => {
    const timestamps: number[] = [];
    await retryWithBackoff({
      delaysMs: [0, 30, 60],
      fn: () => {
        timestamps.push(Date.now());
        return timestamps.length < 3 ? Promise.reject(new Error('falha')) : Promise.resolve('ok');
      },
    });

    expect(timestamps.length).toBe(3);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(25);
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(55);
  });
});
