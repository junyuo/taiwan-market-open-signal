export type IndicatorCategory =
  | 'US_INDEX'
  | 'SEMICONDUCTOR'
  | 'VOLATILITY'
  | 'RATE_FX'
  | 'COMMODITY'
  | 'ASIA_INDEX';

export type IndicatorStatus = 'ok' | 'stale' | 'failed';
export type VerificationStatus = 'matched' | 'mismatch' | 'unavailable' | 'not_configured';
export type SourceStatus = 'ok' | 'degraded' | 'failed' | 'not_configured';

export interface IndicatorDefinition {
  id: string;
  name: string;
  symbol: string;
  category: IndicatorCategory;
  core: boolean;
  maxAgeHours: number;
}

export interface LastGoodValue {
  price: number;
  change: number;
  changePercent: number;
  timestamp: string;
  generatedAt: string;
}

export interface IndicatorVerification {
  source: 'FRED';
  seriesId: 'DGS10';
  status: VerificationStatus;
  value: number | null;
  timestamp: string | null;
  difference: number | null;
  message: string;
}

export interface MarketIndicator extends IndicatorDefinition {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  score: number;
  status: IndicatorStatus;
  source: string;
  timestamp: string | null;
  error?: string;
  isScored: boolean;
  scoreReason: string;
  ageHours: number | null;
  lastGood?: LastGoodValue;
  verification?: IndicatorVerification;
}

export interface SignalDriver {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface MarketSignal {
  label: '明顯偏多' | '偏多' | '震盪' | '偏空' | '明顯偏空';
  score: number;
  summary: string;
  bias:
    | 'strongly_bullish'
    | 'bullish'
    | 'neutral'
    | 'bearish'
    | 'strongly_bearish';
  drivers: SignalDriver[];
}

export interface DataQuality {
  status: 'ok' | 'degraded' | 'failed';
  successCount: number;
  failedCount: number;
  staleCount: number;
  fallbackCount: number;
  coreSuccessRate: number;
}

export interface SourceHealth {
  id: 'yahoo' | 'fred';
  name: string;
  status: SourceStatus;
  successCount: number;
  failedCount: number;
  lastCheckedAt: string;
  message: string;
}

export interface MarketSnapshot {
  date: string;
  generatedAt: string;
  market: 'TW';
  signal: MarketSignal;
  indicators: MarketIndicator[];
  dataQuality: DataQuality;
  sources: SourceHealth[];
}

export interface DataStatus extends DataQuality {
  lastUpdated: string;
  lastSuccessfulUpdate: string | null;
  errors: string[];
  warnings: string[];
  sources: SourceHealth[];
}

export interface HistorySummary {
  date: string;
  generatedAt: string;
  signal: Pick<MarketSignal, 'label' | 'score' | 'bias'>;
  dataQuality: DataQuality;
}

export interface HistoryIndex {
  generatedAt: string;
  entries: HistorySummary[];
}

export type MarketDirection = 'bullish' | 'neutral' | 'bearish';
export type OutcomeExclusionReason = 'low_quality' | 'neutral_signal' | 'neutral_actual';

export interface OutcomeRecord {
  date: string;
  retrievedAt: string;
  source: 'TWSE MI_5MINS_HIST';
  signal: {
    generatedAt: string;
    label: MarketSignal['label'];
    score: number;
    bias: MarketSignal['bias'];
    direction: MarketDirection;
    qualityStatus: DataQuality['status'];
  };
  market: {
    previousClose: number;
    open: number;
    high: number;
    low: number;
    close: number;
    openingGapPercent: number;
    closeReturnPercent: number;
  };
  actualDirection: MarketDirection;
  eligibility: 'eligible' | 'excluded';
  exclusionReason: OutcomeExclusionReason | null;
  hit: boolean | null;
}

export interface EvaluationMetric {
  hits: number;
  total: number;
  hitRate: number | null;
}

export interface SignalLevelOutcome {
  label: MarketSignal['label'];
  count: number;
  averageOpeningGapPercent: number | null;
}

export interface EvaluationSummary {
  generatedAt: string;
  minimumSampleSize: 20;
  eligibleCount: number;
  excludedCount: number;
  isPublished: boolean;
  period: { from: string; to: string } | null;
  overall: EvaluationMetric;
  bullish: EvaluationMetric;
  bearish: EvaluationMetric;
  bySignalLabel: SignalLevelOutcome[];
}

export const INDICATORS: IndicatorDefinition[] = [
  { id: 'sp500', name: 'S&P 500', symbol: '^GSPC', category: 'US_INDEX', core: false, maxAgeHours: 96 },
  { id: 'nasdaq', name: 'Nasdaq', symbol: '^IXIC', category: 'US_INDEX', core: true, maxAgeHours: 96 },
  { id: 'dow', name: 'Dow Jones', symbol: '^DJI', category: 'US_INDEX', core: false, maxAgeHours: 96 },
  { id: 'sox', name: 'SOX 費半', symbol: '^SOX', category: 'SEMICONDUCTOR', core: true, maxAgeHours: 96 },
  { id: 'tsm', name: 'TSM ADR', symbol: 'TSM', category: 'SEMICONDUCTOR', core: true, maxAgeHours: 96 },
  { id: 'nvda', name: 'NVIDIA', symbol: 'NVDA', category: 'SEMICONDUCTOR', core: true, maxAgeHours: 96 },
  { id: 'amd', name: 'AMD', symbol: 'AMD', category: 'SEMICONDUCTOR', core: false, maxAgeHours: 96 },
  { id: 'asml', name: 'ASML', symbol: 'ASML', category: 'SEMICONDUCTOR', core: false, maxAgeHours: 96 },
  { id: 'vix', name: 'VIX', symbol: '^VIX', category: 'VOLATILITY', core: true, maxAgeHours: 96 },
  { id: 'tnx', name: '美國 10 年期殖利率', symbol: '^TNX', category: 'RATE_FX', core: true, maxAgeHours: 96 },
  { id: 'usdtwd', name: 'USD/TWD', symbol: 'TWD=X', category: 'RATE_FX', core: true, maxAgeHours: 24 },
  { id: 'wti', name: 'WTI 原油', symbol: 'CL=F', category: 'COMMODITY', core: false, maxAgeHours: 24 },
  { id: 'gold', name: '黃金', symbol: 'GC=F', category: 'COMMODITY', core: false, maxAgeHours: 24 },
  { id: 'nikkei', name: '日經 225', symbol: '^N225', category: 'ASIA_INDEX', core: false, maxAgeHours: 48 },
  { id: 'hsi', name: '香港恆生', symbol: '^HSI', category: 'ASIA_INDEX', core: false, maxAgeHours: 48 }
];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  US_INDEX: '美股指數',
  SEMICONDUCTOR: '半導體',
  VOLATILITY: '波動率',
  RATE_FX: '利率／匯率',
  COMMODITY: '商品',
  ASIA_INDEX: '亞洲股市'
};
