import type {
  EvaluationMetric,
  EvaluationSummary,
  MarketDirection,
  MarketSnapshot,
  OutcomeExclusionReason,
  OutcomeRecord
} from './indicators';

export const MINIMUM_EVALUATION_SAMPLES = 20 as const;
export const OPENING_GAP_THRESHOLD_PERCENT = 0.3;

const SIGNAL_LABELS: MarketSnapshot['signal']['label'][] = ['明顯偏多', '偏多', '震盪', '偏空', '明顯偏空'];

export interface TwseDailyIndex {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function signalDirection(bias: MarketSnapshot['signal']['bias']): MarketDirection {
  if (bias === 'strongly_bullish' || bias === 'bullish') return 'bullish';
  if (bias === 'strongly_bearish' || bias === 'bearish') return 'bearish';
  return 'neutral';
}

export function classifyOpeningGap(openingGapPercent: number): MarketDirection {
  if (openingGapPercent > OPENING_GAP_THRESHOLD_PERCENT) return 'bullish';
  if (openingGapPercent < -OPENING_GAP_THRESHOLD_PERCENT) return 'bearish';
  return 'neutral';
}

export function exclusionReason(
  quality: MarketSnapshot['dataQuality']['status'],
  predicted: MarketDirection,
  actual: MarketDirection
): OutcomeExclusionReason | null {
  if (quality !== 'ok') return 'low_quality';
  if (predicted === 'neutral') return 'neutral_signal';
  if (actual === 'neutral') return 'neutral_actual';
  return null;
}

export function buildOutcomeRecord(
  snapshot: MarketSnapshot,
  today: TwseDailyIndex,
  previous: TwseDailyIndex,
  retrievedAt: string
): OutcomeRecord {
  if (snapshot.date !== today.date) throw new Error('訊號日期與 TWSE 結果日期不一致');
  if (previous.date >= today.date) throw new Error('前一交易日必須早於結果日期');
  const openingGapPercent = (today.open / previous.close - 1) * 100;
  const closeReturnPercent = (today.close / previous.close - 1) * 100;
  const predicted = signalDirection(snapshot.signal.bias);
  const actual = classifyOpeningGap(openingGapPercent);
  const reason = exclusionReason(snapshot.dataQuality.status, predicted, actual);
  return {
    date: today.date,
    retrievedAt,
    source: 'TWSE MI_5MINS_HIST',
    signal: {
      generatedAt: snapshot.generatedAt,
      label: snapshot.signal.label,
      score: snapshot.signal.score,
      bias: snapshot.signal.bias,
      direction: predicted,
      qualityStatus: snapshot.dataQuality.status
    },
    market: {
      previousClose: previous.close,
      open: today.open,
      high: today.high,
      low: today.low,
      close: today.close,
      openingGapPercent,
      closeReturnPercent
    },
    actualDirection: actual,
    eligibility: reason ? 'excluded' : 'eligible',
    exclusionReason: reason,
    hit: reason ? null : predicted === actual
  };
}

function metric(records: OutcomeRecord[]): EvaluationMetric {
  const hits = records.filter(({ hit }) => hit === true).length;
  return { hits, total: records.length, hitRate: records.length ? hits / records.length : null };
}

export function buildEvaluationSummary(records: OutcomeRecord[], generatedAt: string): EvaluationSummary {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const eligible = sorted.filter(({ eligibility }) => eligibility === 'eligible');
  const bullish = eligible.filter(({ signal }) => signal.direction === 'bullish');
  const bearish = eligible.filter(({ signal }) => signal.direction === 'bearish');
  return {
    generatedAt,
    minimumSampleSize: MINIMUM_EVALUATION_SAMPLES,
    eligibleCount: eligible.length,
    excludedCount: sorted.length - eligible.length,
    isPublished: eligible.length >= MINIMUM_EVALUATION_SAMPLES,
    period: sorted.length ? { from: sorted[0].date, to: sorted[sorted.length - 1].date } : null,
    overall: metric(eligible),
    bullish: metric(bullish),
    bearish: metric(bearish),
    bySignalLabel: SIGNAL_LABELS.map((label) => {
      const matching = sorted.filter(({ signal }) => signal.label === label);
      return {
        label,
        count: matching.length,
        averageOpeningGapPercent: matching.length
          ? matching.reduce((sum, { market }) => sum + market.openingGapPercent, 0) / matching.length
          : null
      };
    })
  };
}
