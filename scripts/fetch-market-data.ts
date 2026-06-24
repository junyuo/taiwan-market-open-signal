import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { INDICATORS, type DataQuality, type DataStatus, type MarketIndicator, type MarketSnapshot } from '../src/lib/indicators';
import { scoreIndicator } from '../src/lib/scoring';
import { scoreSignal } from './score-signal';
import { validateSnapshot } from './validate-data';
import { fetchYahooQuote } from './utils/yahoo';

const STALE_AFTER_MS = 96 * 60 * 60 * 1_000;

function taipeiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

async function fetchIndicator(definition: (typeof INDICATORS)[number], now: Date): Promise<MarketIndicator> {
  try {
    const quote = await fetchYahooQuote(definition.symbol);
    const stale = now.getTime() - Date.parse(quote.timestamp) > STALE_AFTER_MS;
    return {
      ...definition,
      ...quote,
      score: stale ? 0 : scoreIndicator(definition.id, quote.changePercent),
      status: stale ? 'stale' : 'ok',
      source: 'Yahoo Finance'
    };
  } catch (error) {
    return {
      ...definition,
      price: null,
      change: null,
      changePercent: null,
      score: 0,
      status: 'failed',
      source: 'Yahoo Finance',
      timestamp: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function assessQuality(indicators: MarketIndicator[]): DataQuality {
  const core = indicators.filter(({ core }) => core);
  const availableCore = core.filter(({ status }) => status === 'ok').length;
  const ratio = availableCore / core.length;
  return {
    status: availableCore === 0 ? 'failed' : ratio < 0.7 ? 'degraded' : 'ok',
    successCount: indicators.filter(({ status }) => status === 'ok').length,
    failedCount: indicators.filter(({ status }) => status === 'failed').length,
    staleCount: indicators.filter(({ status }) => status === 'stale').length
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const indicators = await Promise.all(INDICATORS.map((definition) => fetchIndicator(definition, now)));
  const dataQuality = assessQuality(indicators);
  const snapshot: MarketSnapshot = {
    date: taipeiDate(now),
    generatedAt: now.toISOString(),
    market: 'TW',
    signal: scoreSignal(indicators),
    indicators,
    dataQuality
  };
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Generated data failed validation:\n${errors.join('\n')}`);

  const status: DataStatus = {
    lastUpdated: snapshot.generatedAt,
    ...dataQuality,
    errors: indicators
      .filter(({ status }) => status !== 'ok')
      .map(({ name, status: itemStatus, error }) => `${name}: ${itemStatus}${error ? ` (${error})` : ''}`)
  };
  const dataRoot = resolve('public/data');
  await Promise.all([
    atomicWriteJson(resolve(dataRoot, 'latest.json'), snapshot),
    atomicWriteJson(resolve(dataRoot, 'history', `${snapshot.date}.json`), snapshot),
    atomicWriteJson(resolve(dataRoot, 'status.json'), status)
  ]);
  console.log(`Generated ${snapshot.date}: ${dataQuality.status}, ${dataQuality.successCount}/${indicators.length} ok`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
