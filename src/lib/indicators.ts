export type IndicatorCategory =
  | 'US_INDEX'
  | 'SEMICONDUCTOR'
  | 'VOLATILITY'
  | 'RATE_FX'
  | 'COMMODITY'
  | 'ASIA_INDEX';

export type IndicatorStatus = 'ok' | 'stale' | 'failed';

export interface IndicatorDefinition {
  id: string;
  name: string;
  symbol: string;
  category: IndicatorCategory;
  core: boolean;
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
}

export interface DataQuality {
  status: 'ok' | 'degraded' | 'failed';
  successCount: number;
  failedCount: number;
  staleCount: number;
}

export interface MarketSnapshot {
  date: string;
  generatedAt: string;
  market: 'TW';
  signal: MarketSignal;
  indicators: MarketIndicator[];
  dataQuality: DataQuality;
}

export interface DataStatus extends DataQuality {
  lastUpdated: string;
  errors: string[];
}

export const INDICATORS: IndicatorDefinition[] = [
  { id: 'sp500', name: 'S&P 500', symbol: '^GSPC', category: 'US_INDEX', core: false },
  { id: 'nasdaq', name: 'Nasdaq', symbol: '^IXIC', category: 'US_INDEX', core: true },
  { id: 'dow', name: 'Dow Jones', symbol: '^DJI', category: 'US_INDEX', core: false },
  { id: 'sox', name: 'SOX 費半', symbol: '^SOX', category: 'SEMICONDUCTOR', core: true },
  { id: 'tsm', name: 'TSM ADR', symbol: 'TSM', category: 'SEMICONDUCTOR', core: true },
  { id: 'nvda', name: 'NVIDIA', symbol: 'NVDA', category: 'SEMICONDUCTOR', core: true },
  { id: 'amd', name: 'AMD', symbol: 'AMD', category: 'SEMICONDUCTOR', core: false },
  { id: 'asml', name: 'ASML', symbol: 'ASML', category: 'SEMICONDUCTOR', core: false },
  { id: 'vix', name: 'VIX', symbol: '^VIX', category: 'VOLATILITY', core: true },
  { id: 'tnx', name: '美國 10 年期殖利率', symbol: '^TNX', category: 'RATE_FX', core: true },
  { id: 'usdtwd', name: 'USD/TWD', symbol: 'TWD=X', category: 'RATE_FX', core: true },
  { id: 'wti', name: 'WTI 原油', symbol: 'CL=F', category: 'COMMODITY', core: false },
  { id: 'gold', name: '黃金', symbol: 'GC=F', category: 'COMMODITY', core: false },
  { id: 'nikkei', name: '日經 225', symbol: '^N225', category: 'ASIA_INDEX', core: false },
  { id: 'hsi', name: '香港恆生', symbol: '^HSI', category: 'ASIA_INDEX', core: false }
];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  US_INDEX: '美股指數',
  SEMICONDUCTOR: '半導體',
  VOLATILITY: '波動率',
  RATE_FX: '利率／匯率',
  COMMODITY: '商品',
  ASIA_INDEX: '亞洲股市'
};
