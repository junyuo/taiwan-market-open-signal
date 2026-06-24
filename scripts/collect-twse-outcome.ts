import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEvaluationSummary, buildOutcomeRecord } from '../src/lib/evaluation';
import type { EvaluationSummary, MarketSnapshot, OutcomeRecord } from '../src/lib/indicators';
import { validateEvaluationSummary, validateOutcomeRecord } from './validate-data';
import { findTwseOutcomeRows } from './utils/twse';

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
    throw error;
  }
}

async function readOutcomes(root: string): Promise<OutcomeRecord[]> {
  try {
    const files = (await readdir(root)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
    return Promise.all(files.map(async (name) => JSON.parse(await readFile(resolve(root, name), 'utf8')) as OutcomeRecord));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function equivalentOutcome(left: OutcomeRecord, right: OutcomeRecord): boolean {
  return JSON.stringify({ ...left, retrievedAt: '' }) === JSON.stringify({ ...right, retrievedAt: '' });
}

export interface CollectOutcomeOptions {
  now?: Date;
  dataRoot?: string;
  fetcher?: typeof fetch;
}

export async function collectOutcome(options: CollectOutcomeOptions = {}): Promise<'written' | 'unchanged' | 'no-op'> {
  const now = options.now ?? new Date();
  const date = taipeiDate(now);
  const dataRoot = resolve(options.dataRoot ?? 'public/data');
  const snapshotPath = resolve(dataRoot, 'history', `${date}.json`);
  const snapshot = await readJsonIfExists<MarketSnapshot>(snapshotPath);
  if (!snapshot || snapshot.date !== date) {
    console.log(`No-op: ${date} 尚無盤前 signal history。`);
    return 'no-op';
  }

  const rows = await findTwseOutcomeRows(date, options.fetcher);
  if (!rows) {
    console.log(`No-op: ${date} 為非交易日，或 TWSE 尚未發布當日資料。`);
    return 'no-op';
  }

  const outcomesRoot = resolve(dataRoot, 'outcomes');
  const outcomePath = resolve(outcomesRoot, `${date}.json`);
  const existing = await readJsonIfExists<OutcomeRecord>(outcomePath);
  let record = buildOutcomeRecord(snapshot, rows.today, rows.previous, now.toISOString());
  if (existing && equivalentOutcome(existing, record)) record = existing;

  const outcomeErrors = validateOutcomeRecord(record);
  if (outcomeErrors.length) throw new Error(`Outcome validation failed:\n${outcomeErrors.join('\n')}`);

  const prior = (await readOutcomes(outcomesRoot)).filter(({ date: outcomeDate }) => outcomeDate !== date);
  const records = [...prior, record];
  const summary = buildEvaluationSummary(records, record.retrievedAt);
  const summaryErrors = validateEvaluationSummary(summary, records);
  if (summaryErrors.length) throw new Error(`Evaluation validation failed:\n${summaryErrors.join('\n')}`);
  const existingSummary = await readJsonIfExists<EvaluationSummary>(resolve(dataRoot, 'evaluation.json'));

  const recordChanged = !existing || !equivalentOutcome(existing, record);
  const summaryChanged = JSON.stringify(existingSummary) !== JSON.stringify(summary);
  if (!recordChanged && !summaryChanged) {
    console.log(`Unchanged: ${date} outcome 已是最新版本。`);
    return 'unchanged';
  }

  if (recordChanged) await atomicWriteJson(outcomePath, record);
  if (summaryChanged) await atomicWriteJson(resolve(dataRoot, 'evaluation.json'), summary);
  console.log(`Collected ${date}: ${record.eligibility}, hit=${String(record.hit)}, eligible=${summary.eligibleCount}`);
  return 'written';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  collectOutcome().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
