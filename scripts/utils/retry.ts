export interface RetryOptions {
  retries?: number;
  delaysMs?: number[];
  onRetry?: (error: unknown, retryNumber: number, delayMs: number) => void;
}

const DEFAULT_DELAYS = [1_000, 3_000, 9_000];

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const delays = options.delaysMs ?? DEFAULT_DELAYS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      const delayMs = delays[Math.min(attempt, delays.length - 1)] ?? 9_000;
      options.onRetry?.(error, attempt + 1, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
