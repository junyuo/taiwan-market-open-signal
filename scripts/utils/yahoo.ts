import { withRetry } from './retry';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

export interface YahooQuote {
  price: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuote> {
  return withRetry(
    async () => {
      const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d&events=history`;
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0 market-signal-bot/1.0' },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as YahooChartResponse;
      if (payload.chart?.error) {
        throw new Error(payload.chart.error.description ?? payload.chart.error.code ?? 'Yahoo API error');
      }

      const result = payload.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const points = closes
        .map((close, index) => ({ close, timestamp: timestamps[index] }))
        .filter(
          (point): point is { close: number; timestamp: number } =>
            typeof point.close === 'number' && Number.isFinite(point.close) &&
            typeof point.timestamp === 'number'
        );

      if (points.length < 2) throw new Error('Not enough completed price points');
      const current = points.at(-1)!;
      const previous = points.at(-2)!;
      const change = current.close - previous.close;
      return {
        price: current.close,
        change,
        changePercent: (change / previous.close) * 100,
        timestamp: new Date(current.timestamp * 1_000).toISOString()
      };
    },
    {
      retries: 3,
      delaysMs: [1_000, 3_000, 9_000],
      onRetry: (error, retry, delayMs) =>
        console.warn(`[Yahoo ${symbol}] retry ${retry}/3 in ${delayMs}ms: ${error instanceof Error ? error.message : error}`)
    }
  );
}
