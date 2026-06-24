import { describe, expect, it } from 'vitest';
import type { MarketSnapshot, OutcomeRecord } from './indicators';
import {
  buildEvaluationSummary,
  buildOutcomeRecord,
  classifyOpeningGap,
  exclusionReason
} from './evaluation';

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    date: '2026-06-24', generatedAt: '2026-06-24T00:55:00.000Z', market: 'TW',
    signal: { label: '偏多', score: 3, summary: '', bias: 'bullish', drivers: [] },
    indicators: [],
    dataQuality: { status: 'ok', successCount: 15, failedCount: 0, staleCount: 0, fallbackCount: 0, coreSuccessRate: 1 },
    sources: [], ...overrides
  };
}

function outcome(index: number, direction: 'bullish' | 'bearish' = 'bullish'): OutcomeRecord {
  const date = `2026-05-${String(index + 1).padStart(2, '0')}`;
  return {
    date, retrievedAt: `${date}T06:30:00.000Z`, source: 'TWSE MI_5MINS_HIST',
    signal: { generatedAt: `${date}T00:55:00.000Z`, label: direction === 'bullish' ? '偏多' : '偏空', score: direction === 'bullish' ? 2 : -2, bias: direction, direction, qualityStatus: 'ok' },
    market: { previousClose: 100, open: direction === 'bullish' ? 101 : 99, high: 102, low: 98, close: 100, openingGapPercent: direction === 'bullish' ? 1 : -1, closeReturnPercent: 0 },
    actualDirection: direction, eligibility: 'eligible', exclusionReason: null, hit: true
  };
}

describe('outcome evaluation', () => {
  it('treats exact ±0.3% boundaries as neutral', () => {
    expect(classifyOpeningGap(0.3)).toBe('neutral');
    expect(classifyOpeningGap(-0.3)).toBe('neutral');
    expect(classifyOpeningGap(0.300001)).toBe('bullish');
    expect(classifyOpeningGap(-0.300001)).toBe('bearish');
  });

  it('excludes neutral signals, neutral outcomes, and low-quality signals', () => {
    expect(exclusionReason('ok', 'neutral', 'bullish')).toBe('neutral_signal');
    expect(exclusionReason('ok', 'bullish', 'neutral')).toBe('neutral_actual');
    expect(exclusionReason('degraded', 'bullish', 'bullish')).toBe('low_quality');
  });

  it('judges bullish and bearish hits from the opening gap', () => {
    const bullish = buildOutcomeRecord(snapshot(), { date: '2026-06-24', open: 101, high: 102, low: 99, close: 100 }, { date: '2026-06-23', open: 100, high: 101, low: 99, close: 100 }, '2026-06-24T06:30:00.000Z');
    expect(bullish.actualDirection).toBe('bullish');
    expect(bullish.hit).toBe(true);
    const bearishSnapshot = snapshot({ signal: { label: '偏空', score: -3, summary: '', bias: 'bearish', drivers: [] } });
    const bearish = buildOutcomeRecord(bearishSnapshot, { date: '2026-06-24', open: 99, high: 100, low: 98, close: 99 }, { date: '2026-06-23', open: 100, high: 101, low: 99, close: 100 }, '2026-06-24T06:30:00.000Z');
    expect(bearish.actualDirection).toBe('bearish');
    expect(bearish.hit).toBe(true);
  });

  it('keeps hit rates private until 20 eligible samples', () => {
    expect(buildEvaluationSummary(Array.from({ length: 19 }, (_, index) => outcome(index)), '2026-06-24T06:30:00.000Z').isPublished).toBe(false);
    const summary = buildEvaluationSummary(Array.from({ length: 20 }, (_, index) => outcome(index, index % 2 ? 'bearish' : 'bullish')), '2026-06-24T06:30:00.000Z');
    expect(summary.isPublished).toBe(true);
    expect(summary.overall).toEqual({ hits: 20, total: 20, hitRate: 1 });
    expect(summary.bullish.total).toBe(10);
    expect(summary.bearish.total).toBe(10);
  });
});
