import type { MarketIndicator, MarketSignal } from '../src/lib/indicators';
import { calculateSignal } from '../src/lib/scoring';

export function scoreSignal(indicators: MarketIndicator[]): MarketSignal {
  return calculateSignal(indicators);
}
