import type { MarketIndicator, MarketSignal } from './indicators';

function scoreByThresholds(
  value: number,
  thresholds: Array<{ test: (value: number) => boolean; score: number }>
): number {
  return thresholds.find(({ test }) => test(value))?.score ?? 0;
}

export function scoreIndicator(id: string, changePercent: number): number {
  switch (id) {
    case 'nasdaq':
      return scoreByThresholds(changePercent, [
        { test: (v) => v > 1, score: 2 },
        { test: (v) => v >= 0.3, score: 1 },
        { test: (v) => v >= -0.3, score: 0 },
        { test: (v) => v >= -1, score: -1 },
        { test: () => true, score: -2 }
      ]);
    case 'sox':
      return scoreByThresholds(changePercent, [
        { test: (v) => v > 1.5, score: 3 },
        { test: (v) => v >= 0.5, score: 1 },
        { test: (v) => v >= -0.5, score: 0 },
        { test: (v) => v >= -1.5, score: -1 },
        { test: () => true, score: -3 }
      ]);
    case 'tsm':
      return changePercent > 1 ? 2 : changePercent < -1 ? -2 : 0;
    case 'nvda':
      return changePercent > 1.5 ? 1 : changePercent < -1.5 ? -1 : 0;
    case 'vix':
      return changePercent > 5 ? -2 : changePercent < -5 ? 1 : 0;
    case 'tnx':
      return changePercent > 2 ? -1 : changePercent < -2 ? 1 : 0;
    case 'usdtwd':
      return changePercent > 0.3 ? -1 : changePercent < -0.3 ? 1 : 0;
    default:
      return 0;
  }
}

export function classifySignal(score: number): Pick<MarketSignal, 'label' | 'bias'> {
  if (score >= 6) return { label: '明顯偏多', bias: 'strongly_bullish' };
  if (score >= 2) return { label: '偏多', bias: 'bullish' };
  if (score >= -1) return { label: '震盪', bias: 'neutral' };
  if (score >= -5) return { label: '偏空', bias: 'bearish' };
  return { label: '明顯偏空', bias: 'strongly_bearish' };
}

function displayMove(indicator: MarketIndicator): string {
  const value = indicator.changePercent ?? 0;
  return `${indicator.name}${value >= 0 ? '上漲' : '下跌'} ${Math.abs(value).toFixed(2)}%`;
}

export function buildSummary(indicators: MarketIndicator[], score: number): string {
  const usable = indicators.filter((item) => item.status === 'ok' && item.score !== 0);
  const positives = usable.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const negatives = usable.filter((item) => item.score < 0).sort((a, b) => a.score - b.score);

  if (!usable.length) return '核心市場資料不足，暫無法形成可靠方向，開盤前宜保守觀察。';

  const direction = score >= 2 ? '整體訊號偏多' : score <= -2 ? '整體訊號偏空' : '多空訊號交錯';
  const details = [...positives.slice(0, 1), ...negatives.slice(0, 1)].map(displayMove);
  return `${details.join('，')}；${direction}，仍需留意盤前突發消息與期貨變化。`;
}

export function calculateSignal(indicators: MarketIndicator[]): MarketSignal {
  const score = indicators.reduce((total, indicator) => total + indicator.score, 0);
  return { ...classifySignal(score), score, summary: buildSummary(indicators, score) };
}
