import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  INDICATORS,
  type DataStatus,
  type MarketIndicator,
  type MarketSnapshot,
  type SourceHealth
} from '../src/lib/indicators';
import {
  assessQuality,
  buildFailedIndicator,
  buildHistoryIndex,
  buildIndicatorFromQuote,
  verifyFredTnx
} from '../src/lib/market-data';
import { scoreSignal } from './score-signal';
import { validateHistoryIndex, validateSnapshot } from './validate-data';
import { fetchFredSeries, latestFredValue } from './utils/fred';
import { fetchYahooQuote } from './utils/yahoo';

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

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    console.warn(`Ignoring unreadable previous data ${filePath}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function fetchIndicator(
  definition: (typeof INDICATORS)[number],
  previous: MarketIndicator | undefined,
  previousGeneratedAt: string | undefined,
  now: Date
): Promise<MarketIndicator> {
  try {
    const quote = await fetchYahooQuote(definition.symbol);
    return buildIndicatorFromQuote(definition, quote, previous, previousGeneratedAt, now);
  } catch (error) {
    return buildFailedIndicator(definition, error, previous, previousGeneratedAt, now);
  }
}

async function readHistorySnapshots(historyRoot: string): Promise<MarketSnapshot[]> {
  try {
    const names = (await readdir(historyRoot)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
    const snapshots = await Promise.all(names.map((name) => readJsonIfExists<MarketSnapshot>(resolve(historyRoot, name))));
    return snapshots.filter((value): value is MarketSnapshot => Boolean(value?.date && value?.generatedAt && value?.signal && value?.dataQuality));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const dataRoot = resolve('public/data');
  const previous = await readJsonIfExists<MarketSnapshot>(resolve(dataRoot, 'latest.json'));
  const previousStatus = await readJsonIfExists<DataStatus>(resolve(dataRoot, 'status.json'));
  const previousById = new Map((previous?.indicators ?? []).map((indicator) => [indicator.id, indicator]));

  let indicators = await Promise.all(
    INDICATORS.map((definition) => fetchIndicator(definition, previousById.get(definition.id), previous?.generatedAt, now))
  );

  const tnx = indicators.find(({ id }) => id === 'tnx');
  const fredKey = process.env.FRED_API_KEY?.trim();
  let fredError: string | undefined;
  let fredValue: number | null = null;
  let fredTimestamp: string | null = null;
  if (fredKey) {
    try {
      const fred = latestFredValue(await fetchFredSeries('DGS10', fredKey));
      fredValue = fred.value;
      fredTimestamp = fred.timestamp;
    } catch (error) {
      fredError = error instanceof Error ? error.message : String(error);
    }
  }
  const verification = verifyFredTnx(tnx?.price ?? null, fredValue, fredTimestamp, now, Boolean(fredKey), fredError);
  indicators = indicators.map((indicator) => indicator.id === 'tnx' ? { ...indicator, verification } : indicator);

  const yahooSuccess = indicators.filter(({ status }) => status !== 'failed').length;
  const yahooFailed = indicators.length - yahooSuccess;
  const sources: SourceHealth[] = [
    {
      id: 'yahoo', name: 'Yahoo Finance',
      status: yahooSuccess === 0 ? 'failed' : yahooFailed > 0 ? 'degraded' : 'ok',
      successCount: yahooSuccess, failedCount: yahooFailed, lastCheckedAt: generatedAt,
      message: yahooFailed ? `${yahooFailed} 項指標抓取失敗` : '15 項指標皆取得回應'
    },
    {
      id: 'fred', name: 'FRED DGS10',
      status: verification.status === 'not_configured' ? 'not_configured' : verification.status === 'matched' ? 'ok' : verification.status === 'mismatch' ? 'degraded' : 'failed',
      successCount: verification.status === 'matched' || verification.status === 'mismatch' ? 1 : 0,
      failedCount: verification.status === 'unavailable' ? 1 : 0,
      lastCheckedAt: generatedAt,
      message: verification.message
    }
  ];

  const dataQuality = assessQuality(indicators, verification.status === 'mismatch');
  const snapshot: MarketSnapshot = {
    date: taipeiDate(now), generatedAt, market: 'TW',
    signal: scoreSignal(indicators), indicators, dataQuality, sources
  };
  const errors = validateSnapshot(snapshot, { requireV2: true, now });
  if (errors.length) throw new Error(`Generated data failed validation:\n${errors.join('\n')}`);

  const warnings = [
    ...indicators.filter(({ status }) => status === 'stale').map(({ name, ageHours: itemAge }) => `${name}: stale (${itemAge?.toFixed(1)} 小時)`),
    ...indicators.filter(({ lastGood }) => Boolean(lastGood)).map(({ name }) => `${name}: 已保留 last-good 參考值`),
    ...(verification.status !== 'matched' ? [`FRED: ${verification.message}`] : [])
  ];
  const status: DataStatus = {
    lastUpdated: generatedAt,
    lastSuccessfulUpdate: dataQuality.status === 'ok'
      ? generatedAt
      : previousStatus?.lastSuccessfulUpdate ?? (previous?.dataQuality.status === 'ok' ? previous.generatedAt : null),
    ...dataQuality,
    errors: indicators.filter(({ status }) => status === 'failed').map(({ name, error }) => `${name}: failed${error ? ` (${error})` : ''}`),
    warnings,
    sources
  };

  const historyRoot = resolve(dataRoot, 'history');
  const history = buildHistoryIndex([...(await readHistorySnapshots(historyRoot)), snapshot], generatedAt);
  const historyErrors = validateHistoryIndex(history);
  if (historyErrors.length) throw new Error(`History index failed validation:\n${historyErrors.join('\n')}`);

  await Promise.all([
    atomicWriteJson(resolve(dataRoot, 'latest.json'), snapshot),
    atomicWriteJson(resolve(dataRoot, 'status.json'), status),
    atomicWriteJson(resolve(historyRoot, `${snapshot.date}.json`), snapshot),
    atomicWriteJson(resolve(historyRoot, 'index.json'), history)
  ]);
  console.log(`Generated ${snapshot.date}: ${dataQuality.status}, ${dataQuality.successCount}/${indicators.length} ok, FRED ${verification.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
