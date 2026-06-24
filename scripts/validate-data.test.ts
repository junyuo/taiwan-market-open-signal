import { describe, expect, it } from 'vitest';
import { INDICATORS, type MarketIndicator, type MarketSnapshot, type SourceHealth } from '../src/lib/indicators';
import { assessQuality } from '../src/lib/market-data';
import { calculateSignal, explainIndicatorScore, scoreIndicator } from '../src/lib/scoring';
import { validateHistoryIndex, validateSnapshot } from './validate-data';

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
});
