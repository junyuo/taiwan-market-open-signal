import type {
  DataQuality,
  HistoryIndex,
  HistorySummary,
  IndicatorDefinition,
  IndicatorVerification,
  LastGoodValue,
  MarketIndicator,
  MarketSnapshot
} from './indicators';
import { explainIndicatorScore, scoreIndicator } from './scoring';

export const LAST_GOOD_MAX_AGE_HOURS = 7 * 24;
export const FRED_MAX_AGE_HOURS = 3 * 24;
export const FRED_MATCH_TOLERANCE = 0.2;

export interface QuoteValues {
  price: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export function ageHours(timestamp: string, now: Date): number {
  return (now.getTime() - Date.parse(timestamp)) / 3_600_000;
}

export function validateQuoteValues(price: number, timestamp: string, now: Date): string | null {
  if (!Number.isFinite(price) || price <= 0) return '價格必須是正數';
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return '市場時間格式錯誤';
  if (time - now.getTime() > 15 * 60_000) return '市場時間超過目前時間 15 分鐘';
  return null;
}

export function pickLastGood(
  previous: MarketIndicator | undefined,
  previousGeneratedAt: string | undefined,
  now: Date
): LastGoodValue | undefined {
  const candidate = previous?.status === 'ok' && previous.timestamp && previous.price !== null &&
    previous.change !== null && previous.changePercent !== null
    ? {
        price: previous.price,
        change: previous.change,
        changePercent: previous.changePercent,
        timestamp: previous.timestamp,
        generatedAt: previousGeneratedAt ?? previous.timestamp
      }
    : previous?.lastGood;
  if (!candidate || ageHours(candidate.timestamp, now) > LAST_GOOD_MAX_AGE_HOURS) return undefined;
  return candidate;
}

export function buildIndicatorFromQuote(
  definition: IndicatorDefinition,
  quote: QuoteValues,
  previous: MarketIndicator | undefined,
  previousGeneratedAt: string | undefined,
  now: Date
): MarketIndicator {
  const invalidReason = validateQuoteValues(quote.price, quote.timestamp, now);
  if (invalidReason) throw new Error(invalidReason);
  const quoteAge = Math.max(0, ageHours(quote.timestamp, now));
  const stale = quoteAge > maxAgeFor(definition);
  const score = stale ? 0 : scoreIndicator(definition.id, quote.changePercent);
  const lastGood = pickLastGood(previous, previousGeneratedAt, now);
  return {
    ...definition, ...quote, score, status: stale ? 'stale' : 'ok', source: 'Yahoo Finance',
    isScored: definition.core,
    scoreReason: stale ? `資料已超過 ${definition.maxAgeHours} 小時，本次不計分` : explainIndicatorScore(definition.id, quote.changePercent, score),
    ageHours: quoteAge,
    ...(stale && lastGood ? { lastGood } : {})
  };
}

export function buildFailedIndicator(
  definition: IndicatorDefinition,
  error: unknown,
  previous: MarketIndicator | undefined,
  previousGeneratedAt: string | undefined,
  now: Date
): MarketIndicator {
  const lastGood = pickLastGood(previous, previousGeneratedAt, now);
  return {
    ...definition, price: null, change: null, changePercent: null, score: 0, status: 'failed',
    source: 'Yahoo Finance', timestamp: null, error: error instanceof Error ? error.message : String(error),
    isScored: definition.core, scoreReason: '資料抓取失敗，本次不計分', ageHours: null,
    ...(lastGood ? { lastGood } : {})
  };
}

export function assessQuality(
  indicators: MarketIndicator[],
  hasVerificationMismatch = false
): DataQuality {
  const core = indicators.filter(({ core }) => core);
  const availableCore = core.filter(({ status }) => status === 'ok').length;
  const coreSuccessRate = core.length ? availableCore / core.length : 0;
  return {
    status: availableCore === 0 ? 'failed' : coreSuccessRate < 0.7 || hasVerificationMismatch ? 'degraded' : 'ok',
    successCount: indicators.filter(({ status }) => status === 'ok').length,
    failedCount: indicators.filter(({ status }) => status === 'failed').length,
    staleCount: indicators.filter(({ status }) => status === 'stale').length,
    fallbackCount: indicators.filter(({ lastGood }) => Boolean(lastGood)).length,
    coreSuccessRate
  };
}

export function verifyFredTnx(
  yahooValue: number | null,
  fredValue: number | null,
  fredTimestamp: string | null,
  now: Date,
  configured: boolean,
  error?: string
): IndicatorVerification {
  if (!configured) {
    return { source: 'FRED', seriesId: 'DGS10', status: 'not_configured', value: null, timestamp: null, difference: null, message: '未設定 FRED_API_KEY' };
  }
  if (error || yahooValue === null || fredValue === null || !fredTimestamp) {
    return { source: 'FRED', seriesId: 'DGS10', status: 'unavailable', value: fredValue, timestamp: fredTimestamp, difference: null, message: error ?? 'Yahoo 或 FRED 缺少可比較資料' };
  }
  const difference = Math.abs(yahooValue - fredValue);
  const fresh = ageHours(fredTimestamp, now) <= FRED_MAX_AGE_HOURS;
  const matched = fresh && difference <= FRED_MATCH_TOLERANCE;
  return {
    source: 'FRED',
    seriesId: 'DGS10',
    status: matched ? 'matched' : 'mismatch',
    value: fredValue,
    timestamp: fredTimestamp,
    difference,
    message: matched ? 'Yahoo 與 FRED 殖利率水準一致' : !fresh ? 'FRED 觀測值超過 3 日' : `來源差距 ${difference.toFixed(2)} 個百分點`
  };
}

export function toHistorySummary(snapshot: MarketSnapshot): HistorySummary {
  return {
    date: snapshot.date,
    generatedAt: snapshot.generatedAt,
    signal: { label: snapshot.signal.label, score: snapshot.signal.score, bias: snapshot.signal.bias },
    dataQuality: snapshot.dataQuality
  };
}

function normalizeLegacyQuality(value: HistorySummary['dataQuality']): DataQuality {
  return {
    ...value,
    fallbackCount: value.fallbackCount ?? 0,
    coreSuccessRate: value.coreSuccessRate ?? 0
  };
}

export function buildHistoryIndex(
  snapshots: Array<MarketSnapshot | HistorySummary>,
  generatedAt: string,
  limit = 30
): HistoryIndex {
  const byDate = new Map<string, HistorySummary>();
  for (const value of snapshots) {
    const summary = 'indicators' in value ? toHistorySummary(value) : { ...value, dataQuality: normalizeLegacyQuality(value.dataQuality) };
    const existing = byDate.get(summary.date);
    if (!existing || Date.parse(summary.generatedAt) > Date.parse(existing.generatedAt)) byDate.set(summary.date, summary);
  }
  return {
    generatedAt,
    entries: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  };
}

export function maxAgeFor(definition: IndicatorDefinition): number {
  return definition.maxAgeHours;
}
