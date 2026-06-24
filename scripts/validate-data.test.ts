import { describe, expect, it } from 'vitest';
import { INDICATORS, type MarketIndicator, type MarketSnapshot, type OutcomeRecord, type SourceHealth } from '../src/lib/indicators';
import { buildEvaluationSummary } from '../src/lib/evaluation';
import { assessQuality } from '../src/lib/market-data';
import { calculateSignal, explainIndicatorScore, scoreIndicator } from '../src/lib/scoring';
import { validateEvaluationSummary, validateHistoryIndex, validateOutcomeRecord, validateSnapshot } from './validate-data';

function validSnapshot(): MarketSnapshot {
  const indicators: MarketIndicator[] = INDICATORS.map((definition) => {
    const score = scoreIndicator(definition.id, 0);
    return {
      ...definition, price: 100, change: 0, changePercent: 0, score, status: 'ok',
      source: 'Yahoo Finance', timestamp: '2026-06-24T00:00:00.000Z', isScored: definition.core,
      scoreReason: explainIndicatorScore(definition.id, 0, score), ageHours: 1
    };
  });
  const sources: SourceHealth[] = [
    { id: 'yahoo', name: 'Yahoo', status: 'ok', successCount: 15, failedCount: 0, lastCheckedAt: '2026-06-24T01:00:00.000Z', message: 'ok' },
    { id: 'fred', name: 'FRED', status: 'not_configured', successCount: 0, failedCount: 0, lastCheckedAt: '2026-06-24T01:00:00.000Z', message: 'missing key' }
  ];
  return { date: '2026-06-24', generatedAt: '2026-06-24T01:00:00.000Z', market: 'TW', signal: calculateSignal(indicators), indicators, dataQuality: assessQuality(indicators), sources };
}

describe('semantic validator', () => {
  it('accepts a valid v2 snapshot', () => {
    expect(validateSnapshot(validSnapshot(), { requireV2: true, now: new Date('2026-06-24T02:00:00.000Z') })).toEqual([]);
  });

  it('catches score, label, counts, and future timestamps', () => {
    const snapshot = validSnapshot();
    snapshot.signal.score = 9;
    snapshot.signal.label = '明顯偏多';
    snapshot.dataQuality.successCount = 14;
    snapshot.indicators[0].timestamp = '2026-06-25T00:00:00.000Z';
    const errors = validateSnapshot(snapshot, { requireV2: true, now: new Date('2026-06-24T02:00:00.000Z') });
    expect(errors.join(' ')).toContain('分數加總');
    expect(errors.join(' ')).toContain('分級規則');
    expect(errors.join(' ')).toContain('計數');
    expect(errors.join(' ')).toContain('未來');
  });

  it('rejects duplicate and unsorted history', () => {
    const entry = { date: '2026-06-24', generatedAt: '2026-06-24T01:00:00.000Z', signal: { label: '震盪' as const, score: 0, bias: 'neutral' as const }, dataQuality: validSnapshot().dataQuality };
    expect(validateHistoryIndex({ generatedAt: entry.generatedAt, entries: [entry, entry] }).join(' ')).toContain('重複');
  });

  it('catches inconsistent outcome calculations and summary counts', () => {
    const outcome: OutcomeRecord = {
      date: '2026-06-24', retrievedAt: '2026-06-24T06:30:00.000Z', source: 'TWSE MI_5MINS_HIST',
      signal: { generatedAt: '2026-06-24T00:55:00.000Z', label: '偏多', score: 2, bias: 'bullish', direction: 'bullish', qualityStatus: 'ok' },
      market: { previousClose: 100, open: 101, high: 102, low: 99, close: 100, openingGapPercent: 1, closeReturnPercent: 0 },
      actualDirection: 'bullish', eligibility: 'eligible', exclusionReason: null, hit: true
    };
    expect(validateOutcomeRecord(outcome)).toEqual([]);
    outcome.market.openingGapPercent = 2;
    expect(validateOutcomeRecord(outcome).join(' ')).toContain('openingGapPercent');
    outcome.market.openingGapPercent = 1;
    const summary = buildEvaluationSummary([outcome], outcome.retrievedAt);
    summary.eligibleCount = 2;
    expect(validateEvaluationSummary(summary, [outcome]).join(' ')).toContain('eligibleCount');
  });
});
