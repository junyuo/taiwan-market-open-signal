import { describe, expect, it } from 'vitest';
import { latestFredValue } from './fred';
import { withRetry } from './retry';
import { parseYahooChart } from './yahoo';

describe('market adapters', () => {
  it('parses the final two valid Yahoo closes', () => {
    const quote = parseYahooChart({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [100, null, 110] }] } }] } });
    expect(quote.price).toBe(110);
    expect(quote.changePercent).toBe(10);
  });

  it('selects the latest valid FRED observation', () => {
    expect(latestFredValue([{ date: '2026-06-20', value: 4.2 }, { date: '2026-06-23', value: 4.5 }])).toEqual({
      value: 4.5, timestamp: '2026-06-23T00:00:00.000Z'
    });
  });

  it('stops after exactly three retries', async () => {
    let attempts = 0;
    await expect(withRetry(async () => {
      attempts += 1;
      throw new Error('offline');
    }, { retries: 3, delaysMs: [0, 0, 0] })).rejects.toThrow('offline');
    expect(attempts).toBe(4);
  });
});
