import { describe, expect, it } from 'vitest';
import { latestFredValue } from './fred';
import { withRetry } from './retry';
import { parseYahooChart } from './yahoo';
import { findTwseOutcomeRows, parseRocDate, parseTwseHistory, parseTwseNumber, previousMonth } from './twse';

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

  it('parses ROC dates and comma-separated TWSE numbers', () => {
    expect(parseRocDate('115/06/24')).toBe('2026-06-24');
    expect(parseTwseNumber('46,043.60')).toBe(46043.6);
    expect(parseTwseHistory({
      stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
      data: [['115/06/24', '46,909.98', '47,000.00', '45,819.71', '46,043.60']]
    })[0]).toEqual({ date: '2026-06-24', open: 46909.98, high: 47000, low: 45819.71, close: 46043.6 });
  });

  it('loads the previous month for the first trading day', async () => {
    expect(previousMonth('2026-01-02')).toBe('2025-12-01');
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      calls.push(String(url));
      const previous = String(url).includes('20260501');
      return new Response(JSON.stringify({
        stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
        data: previous
          ? [['115/05/29', '99', '101', '98', '100']]
          : [['115/06/01', '101', '102', '100', '101']]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const rows = await findTwseOutcomeRows('2026-06-01', fakeFetch as typeof fetch);
    expect(rows?.previous.date).toBe('2026-05-29');
    expect(calls).toHaveLength(2);
  });

  it('returns no outcome when the date is a holiday or not published yet', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
      data: [['115/06/23', '99', '101', '98', '100']]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(findTwseOutcomeRows('2026-06-24', fakeFetch as typeof fetch)).resolves.toBeNull();
  });
});
