import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INDICATORS, type MarketSnapshot } from '../src/lib/indicators';

export function validateSnapshot(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['資料根節點必須是物件'];
  const data = value as Partial<MarketSnapshot>;
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
      if (indicator.price !== null || indicator.change !== null || indicator.changePercent !== null) {
        errors.push(`${indicator.id}: failed 數值必須為 null`);
      }
    } else if (
      !Number.isFinite(indicator.price) ||
      !Number.isFinite(indicator.change) ||
      !Number.isFinite(indicator.changePercent) ||
      !indicator.timestamp
    ) {
      errors.push(`${indicator.id}: 可用資料缺少有效數值或時間`);
    }
  }

  const quality = data.dataQuality;
  if (!quality || !['ok', 'degraded', 'failed'].includes(quality.status)) errors.push('dataQuality.status 無效');
  else if (quality.successCount + quality.failedCount + quality.staleCount !== data.indicators.length) {
    errors.push('dataQuality 計數與 indicators 不一致');
  }
  return errors;
}

async function main(): Promise<void> {
  const filePath = resolve(process.argv[2] ?? 'public/data/latest.json');
  const data = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const errors = validateSnapshot(data);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${filePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
