import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  INDICATORS,
  type EvaluationSummary,
  type HistoryIndex,
  type MarketSnapshot,
  type OutcomeRecord
} from '../src/lib/indicators';
import { buildEvaluationSummary, classifyOpeningGap, exclusionReason, signalDirection } from '../src/lib/evaluation';
import { classifySignal } from '../src/lib/scoring';

interface ValidationOptions {
  requireV2?: boolean;
  now?: Date;
}

export function validateSnapshot(value: unknown, options: ValidationOptions = {}): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['資料根節點必須是物件'];
  const data = value as Partial<MarketSnapshot>;
  const now = options.now ?? new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? '')) errors.push('date 格式錯誤');
  if (!data.generatedAt || Number.isNaN(Date.parse(data.generatedAt))) errors.push('generatedAt 格式錯誤');
  if (data.market !== 'TW') errors.push('market 必須為 TW');
  if (!data.signal || !Number.isFinite(data.signal.score)) errors.push('signal.score 必須是數字');
  if (!Array.isArray(data.indicators)) {
    errors.push('indicators 必須是陣列');
    return errors;
  }
  if (data.indicators.length !== INDICATORS.length) errors.push(`indicators 必須包含 ${INDICATORS.length} 筆`);

  const expectedIds = new Set(INDICATORS.map(({ id }) => id));
  const seen = new Set<string>();
  for (const indicator of data.indicators) {
    if (!expectedIds.has(indicator.id)) errors.push(`未知指標: ${indicator.id}`);
    if (seen.has(indicator.id)) errors.push(`重複指標: ${indicator.id}`);
    seen.add(indicator.id);
    if (!['ok', 'stale', 'failed'].includes(indicator.status)) errors.push(`${indicator.id}: status 無效`);
    if (indicator.status === 'failed') {
      if (indicator.price !== null || indicator.change !== null || indicator.changePercent !== null || indicator.score !== 0) {
        errors.push(`${indicator.id}: failed 數值必須為 null 且 score 必須為 0`);
      }
    } else if (
      !Number.isFinite(indicator.price) || !Number.isFinite(indicator.change) ||
      !Number.isFinite(indicator.changePercent) || !indicator.timestamp
    ) {
      errors.push(`${indicator.id}: 可用資料缺少有效數值或時間`);
    }
    if (indicator.status === 'stale' && indicator.score !== 0) errors.push(`${indicator.id}: stale 不可計分`);
    if (indicator.timestamp && Date.parse(indicator.timestamp) - now.getTime() > 15 * 60_000) errors.push(`${indicator.id}: timestamp 超過未來 15 分鐘`);
    if (indicator.lastGood && (
      !Number.isFinite(indicator.lastGood.price) || indicator.lastGood.price <= 0 ||
      Number.isNaN(Date.parse(indicator.lastGood.timestamp)) || Number.isNaN(Date.parse(indicator.lastGood.generatedAt))
    )) errors.push(`${indicator.id}: lastGood 無效`);
    if (options.requireV2) {
      if (typeof indicator.isScored !== 'boolean') errors.push(`${indicator.id}: 缺少 isScored`);
      if (!indicator.scoreReason) errors.push(`${indicator.id}: 缺少 scoreReason`);
      if (indicator.status !== 'failed' && !Number.isFinite(indicator.ageHours)) errors.push(`${indicator.id}: 缺少 ageHours`);
    }
  }

  if (data.signal) {
    const expectedScore = data.indicators.reduce((total, indicator) => total + indicator.score, 0);
    if (data.signal.score !== expectedScore) errors.push('signal.score 與指標分數加總不一致');
    const expectedClass = classifySignal(expectedScore);
    if (data.signal.label !== expectedClass.label || data.signal.bias !== expectedClass.bias) errors.push('signal label/bias 與分級規則不一致');
    if (options.requireV2 && (!Array.isArray(data.signal.drivers) || data.signal.drivers.length !== INDICATORS.filter(({ core }) => core).length)) {
      errors.push('signal.drivers 必須包含全部計分指標');
    }
  }

  const quality = data.dataQuality;
  if (!quality || !['ok', 'degraded', 'failed'].includes(quality.status)) errors.push('dataQuality.status 無效');
  else {
    if (quality.successCount + quality.failedCount + quality.staleCount !== data.indicators.length) errors.push('dataQuality 計數與 indicators 不一致');
    const expectedFallback = data.indicators.filter(({ lastGood }) => Boolean(lastGood)).length;
    if (quality.fallbackCount !== undefined && quality.fallbackCount !== expectedFallback) errors.push('dataQuality.fallbackCount 不一致');
    const core = data.indicators.filter(({ core }) => core);
    const expectedRate = core.filter(({ status }) => status === 'ok').length / core.length;
    if (quality.coreSuccessRate !== undefined && Math.abs(quality.coreSuccessRate - expectedRate) > 1e-9) errors.push('dataQuality.coreSuccessRate 不一致');
    if (options.requireV2 && (!Number.isFinite(quality.coreSuccessRate) || !Number.isInteger(quality.fallbackCount))) errors.push('dataQuality 缺少 v2 計數');
  }
  if (options.requireV2 && (!Array.isArray(data.sources) || data.sources.length !== 2)) errors.push('sources 必須包含 Yahoo 與 FRED');
  return errors;
}

export function validateHistoryIndex(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['history index 必須是物件'];
  const history = value as Partial<HistoryIndex>;
  if (!history.generatedAt || Number.isNaN(Date.parse(history.generatedAt))) errors.push('history.generatedAt 格式錯誤');
  if (!Array.isArray(history.entries)) return [...errors, 'history.entries 必須是陣列'];
  if (history.entries.length > 30) errors.push('history.entries 不可超過 30 筆');
  const dates = new Set<string>();
  let previousDate = '9999-99-99';
  for (const entry of history.entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) errors.push(`history 日期格式錯誤: ${entry.date}`);
    if (dates.has(entry.date)) errors.push(`history 日期重複: ${entry.date}`);
    dates.add(entry.date);
    if (entry.date > previousDate) errors.push('history.entries 必須依日期倒序');
    previousDate = entry.date;
    if (!Number.isFinite(entry.signal?.score)) errors.push(`${entry.date}: signal.score 無效`);
    if (!['ok', 'degraded', 'failed'].includes(entry.dataQuality?.status)) errors.push(`${entry.date}: dataQuality.status 無效`);
  }
  return errors;
}

export function validateOutcomeRecord(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['outcome 必須是物件'];
  const record = value as Partial<OutcomeRecord>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date ?? '')) errors.push('outcome.date 格式錯誤');
  if (!record.retrievedAt || Number.isNaN(Date.parse(record.retrievedAt))) errors.push('outcome.retrievedAt 格式錯誤');
  if (record.source !== 'TWSE MI_5MINS_HIST') errors.push('outcome.source 無效');
  if (!record.signal || !record.market) return [...errors, 'outcome 缺少 signal 或 market'];
  if (record.signal.generatedAt && Date.parse(record.signal.generatedAt) > Date.parse(record.retrievedAt ?? '')) errors.push('signal.generatedAt 不得晚於 retrievedAt');
  const numbers = [record.market.previousClose, record.market.open, record.market.high, record.market.low, record.market.close];
  if (numbers.some((number) => !Number.isFinite(number) || number <= 0)) errors.push('outcome OHLC 與前收必須是正數');
  if (Number.isFinite(record.market.previousClose) && Number.isFinite(record.market.open)) {
    const expectedGap = (record.market.open / record.market.previousClose - 1) * 100;
    if (Math.abs(record.market.openingGapPercent - expectedGap) > 1e-9) errors.push('openingGapPercent 計算不一致');
    if (record.actualDirection !== classifyOpeningGap(expectedGap)) errors.push('actualDirection 與開盤缺口不一致');
  }
  if (Number.isFinite(record.market.previousClose) && Number.isFinite(record.market.close)) {
    const expectedReturn = (record.market.close / record.market.previousClose - 1) * 100;
    if (Math.abs(record.market.closeReturnPercent - expectedReturn) > 1e-9) errors.push('closeReturnPercent 計算不一致');
  }
  const predicted = signalDirection(record.signal.bias);
  if (record.signal.direction !== predicted) errors.push('signal.direction 與 bias 不一致');
  const reason = exclusionReason(record.signal.qualityStatus, predicted, record.actualDirection ?? 'neutral');
  if (record.exclusionReason !== reason) errors.push('exclusionReason 不一致');
  if (record.eligibility !== (reason ? 'excluded' : 'eligible')) errors.push('eligibility 不一致');
  const expectedHit = reason ? null : predicted === record.actualDirection;
  if (record.hit !== expectedHit) errors.push('hit 不一致');
  return errors;
}

export function validateEvaluationSummary(value: unknown, records: OutcomeRecord[]): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['evaluation 必須是物件'];
  const summary = value as Partial<EvaluationSummary>;
  if (!summary.generatedAt || Number.isNaN(Date.parse(summary.generatedAt))) errors.push('evaluation.generatedAt 格式錯誤');
  if (summary.minimumSampleSize !== 20) errors.push('evaluation.minimumSampleSize 必須為 20');
  const expected = buildEvaluationSummary(records, summary.generatedAt ?? new Date(0).toISOString());
  for (const key of ['eligibleCount', 'excludedCount', 'isPublished'] as const) {
    if (summary[key] !== expected[key]) errors.push(`evaluation.${key} 不一致`);
  }
  for (const key of ['overall', 'bullish', 'bearish'] as const) {
    const actualMetric = summary[key];
    const expectedMetric = expected[key];
    if (!actualMetric || actualMetric.hits !== expectedMetric.hits || actualMetric.total !== expectedMetric.total || actualMetric.hitRate !== expectedMetric.hitRate) {
      errors.push(`evaluation.${key} 不一致`);
    }
  }
  if (JSON.stringify(summary.period) !== JSON.stringify(expected.period)) errors.push('evaluation.period 不一致');
  if (JSON.stringify(summary.bySignalLabel) !== JSON.stringify(expected.bySignalLabel)) errors.push('evaluation.bySignalLabel 不一致');
  return errors;
}

async function readOutcomeRecords(root: string): Promise<OutcomeRecord[]> {
  try {
    const names = (await readdir(root)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(root, name), 'utf8')) as OutcomeRecord));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const filePath = resolve(process.argv[2] ?? 'public/data/latest.json');
  const data = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const errors = validateSnapshot(data, { requireV2: true });
  const historyPath = resolve('public/data/history/index.json');
  const history = JSON.parse(await readFile(historyPath, 'utf8')) as unknown;
  errors.push(...validateHistoryIndex(history));
  const outcomes = await readOutcomeRecords(resolve('public/data/outcomes'));
  for (const outcome of outcomes) errors.push(...validateOutcomeRecord(outcome));
  const evaluationPath = resolve('public/data/evaluation.json');
  const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8')) as unknown;
  errors.push(...validateEvaluationSummary(evaluation, outcomes));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${filePath}, ${historyPath}, ${outcomes.length} outcomes, and ${evaluationPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
