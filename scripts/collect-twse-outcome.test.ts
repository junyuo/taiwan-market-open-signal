import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarketSnapshot } from '../src/lib/indicators';
import { collectOutcome } from './collect-twse-outcome';

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function snapshot(): MarketSnapshot {
  return {
    date: '2026-06-24', generatedAt: '2026-06-24T00:55:00.000Z', market: 'TW',
    signal: { label: '偏多', score: 3, summary: '', bias: 'bullish', drivers: [] },
    indicators: [],
    dataQuality: { status: 'ok', successCount: 15, failedCount: 0, staleCount: 0, fallbackCount: 0, coreSuccessRate: 1 },
    sources: []
  };
}

const response = {
  stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
  data: [
    ['115/06/23', '100', '101', '99', '100'],
    ['115/06/24', '101', '102', '100', '101']
  ]
};

describe('outcome collector', () => {
  it('is idempotent when the same day is collected twice', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'twse-outcome-'));
    temporaryRoots.push(root);
    await mkdir(resolve(root, 'history'), { recursive: true });
    await writeFile(resolve(root, 'history/2026-06-24.json'), JSON.stringify(snapshot()), 'utf8');
    const fakeFetch = async () => new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    const options = { now: new Date('2026-06-24T06:30:00.000Z'), dataRoot: root, fetcher: fakeFetch as typeof fetch };

    await expect(collectOutcome(options)).resolves.toBe('written');
    const first = await readFile(resolve(root, 'outcomes/2026-06-24.json'), 'utf8');
    await expect(collectOutcome(options)).resolves.toBe('unchanged');
    expect(await readFile(resolve(root, 'outcomes/2026-06-24.json'), 'utf8')).toBe(first);
  });
});
