import { describe, expect, it } from 'vitest';
import { classifySignal, explainIndicatorScore, scoreIndicator } from './scoring';

describe('scoreIndicator', () => {
  it.each([
    ['nasdaq', 1.01, 2], ['nasdaq', 1, 1], ['nasdaq', 0.3, 1], ['nasdaq', -0.3, 0], ['nasdaq', -1, -1], ['nasdaq', -1.01, -2],
    ['sox', 1.51, 3], ['sox', 1.5, 1], ['sox', 0.5, 1], ['sox', -0.5, 0], ['sox', -1.5, -1], ['sox', -1.51, -3],
    ['tsm', 1.01, 2], ['tsm', -1.01, -2], ['nvda', 1.51, 1], ['nvda', -1.51, -1],
    ['vix', 5.01, -2], ['vix', -5.01, 1], ['tnx', 2.01, -1], ['tnx', -2.01, 1],
    ['usdtwd', 0.31, -1], ['usdtwd', -0.31, 1]
  ])('%s at %s scores %s', (id, value, expected) => {
    expect(scoreIndicator(id as string, value as number)).toBe(expected);
  });

  it('classifies total score boundaries', () => {
    expect(classifySignal(6).bias).toBe('strongly_bullish');
    expect(classifySignal(2).bias).toBe('bullish');
    expect(classifySignal(-1).bias).toBe('neutral');
    expect(classifySignal(-2).bias).toBe('bearish');
    expect(classifySignal(-6).bias).toBe('strongly_bearish');
  });

  it('explains scored and background indicators', () => {
    expect(explainIndicatorScore('nasdaq', 1.2, 2)).toContain('+2');
    expect(explainIndicatorScore('sp500', 1.2, 0)).toContain('背景觀察');
  });
});
