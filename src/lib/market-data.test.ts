import { describe, expect, it } from 'vitest';
import type { HistorySummary, MarketIndicator, MarketSnapshot } from './indicators';
import { assessQuality, buildFailedIndicator, buildHistoryIndex, buildIndicatorFromQuote, pickLastGood, verifyFredTnx } from './market-data';
import { INDICATORS } from './indicators';

function indicator(id: string, core: boolean, status: MarketIndicator['status'] = 'ok'): MarketIndicator {
  return {
    id, name: id, symbol: id, category: 'US_INDEX', core, maxAgeHours: 96,
    price: status === 'failed' ? null : 100, change: status === 'failed' ? null : 1,
    changePercent: status === 'failed' ? null : 1, score: 0, status, source: 'test',
    timestamp: status === 'failed' ? null : '2026-06-24T00:00:00.000Z',
    isScored: core, scoreReason: 'test', ageHours: status === 'failed' ? null : 1
  };
}

describe('data quality and fallback', () => {
  it('uses the 70% core threshold and all-core failure rule', () => {
    const fiveOfSeven = Array.from({ length: 7 }, (_, index) => indicator(`c${index}`, true, index < 5 ? 'ok' : 'failed'));
    expect(assessQuality(fiveOfSeven).status).toBe('ok');
    const fourOfSeven = fiveOfSeven.map((item, index) => index === 4 ? { ...item, status: 'failed' as const, price: null, change: null, changePercent: null, timestamp: null } : item);
    expect(assessQuality(fourOfSeven).status).toBe('degraded');
    expect(assessQuality(fiveOfSeven.map((item) => ({ ...item, status: 'failed' as const }))).status).toBe('failed');
    expect(assessQuality(fiveOfSeven, true).status).toBe('degraded');
  });

  it('keeps last-good for seven days and then expires it', () => {
    const previous = indicator('nasdaq', true);
    expect(pickLastGood(previous, '2026-06-24T00:00:00.000Z', new Date('2026-06-30T23:59:00.000Z'))).toBeDefined();
    expect(pickLastGood(previous, '2026-06-24T00:00:00.000Z', new Date('2026-07-01T01:00:00.000Z'))).toBeUndefined();
  });

  it('isolates one failed Yahoo result and keeps last-good out of scoring', () => {
    const now = new Date('2026-06-24T01:00:00.000Z');
    const definition = INDICATORS.find(({ id }) => id === 'nasdaq')!;
    const previous = indicator('nasdaq', true);
    const failed = buildFailedIndicator(definition, new Error('HTTP 429'), previous, '2026-06-24T00:00:00.000Z', now);
    const healthy = buildIndicatorFromQuote(definition, { price: 101, change: 1, changePercent: 1, timestamp: '2026-06-24T00:00:00.000Z' }, previous, previous.timestamp ?? undefined, now);
    expect(failed.status).toBe('failed');
    expect(failed.score).toBe(0);
    expect(failed.lastGood?.price).toBe(100);
    expect(healthy.status).toBe('ok');
    expect(healthy.score).toBe(1);
  });

  it('classifies FRED verification states', () => {
    const now = new Date('2026-06-24T12:00:00.000Z');
    expect(verifyFredTnx(4.5, null, null, now, false).status).toBe('not_configured');
    expect(verifyFredTnx(4.5, 4.62, '2026-06-24T00:00:00.000Z', now, true).status).toBe('matched');
    expect(verifyFredTnx(4.5, 4.8, '2026-06-24T00:00:00.000Z', now, true).status).toBe('mismatch');
    expect(verifyFredTnx(4.5, 4.5, '2026-06-20T00:00:00.000Z', now, true).status).toBe('mismatch');
  });
});

describe('history index', () => {
  it('deduplicates dates, keeps newest capture, sorts, and trims to 30', () => {
    const entries: HistorySummary[] = Array.from({ length: 32 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10),
      generatedAt: new Date(Date.UTC(2026, 3, 1 + index)).toISOString(),
      signal: { label: '震盪', score: 0, bias: 'neutral' },
      dataQuality: { status: 'ok', successCount: 15, failedCount: 0, staleCount: 0, fallbackCount: 0, coreSuccessRate: 1 }
    }));
    entries.push({ ...entries[31], generatedAt: '2026-05-02T01:00:00.000Z', signal: { label: '偏多', score: 2, bias: 'bullish' } });
    const result = buildHistoryIndex(entries, '2026-06-01T00:00:00.000Z');
    expect(result.entries).toHaveLength(30);
    expect(result.entries[0].date).toBe('2026-05-02');
    expect(result.entries[0].signal.score).toBe(2);
  });

  it('normalizes legacy quality fields', () => {
    const legacy = {
      date: '2026-06-24', generatedAt: '2026-06-24T00:00:00.000Z',
      signal: { label: '震盪', score: 0, bias: 'neutral' },
      dataQuality: { status: 'ok', successCount: 15, failedCount: 0, staleCount: 0 }
    } as unknown as HistorySummary;
    expect(buildHistoryIndex([legacy], legacy.generatedAt).entries[0].dataQuality.fallbackCount).toBe(0);
  });
});
