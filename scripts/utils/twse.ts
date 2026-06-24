import type { TwseDailyIndex } from '../../src/lib/evaluation';
import { withRetry } from './retry';

export const TWSE_SOURCE_NAME = 'TWSE MI_5MINS_HIST';
const ENDPOINT = 'https://www.twse.com.tw/indicesReport/MI_5MINS_HIST';

interface TwseResponse {
  stat?: string;
  fields?: unknown;
  data?: unknown;
}

export function parseRocDate(value: string): string {
  const match = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`無效民國日期: ${value}`);
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
}

export function parseTwseNumber(value: unknown): number {
  const number = Number(String(value).replaceAll(',', '').trim());
  if (!Number.isFinite(number) || number <= 0) throw new Error(`無效 TWSE 數值: ${String(value)}`);
  return number;
}

export function parseTwseHistory(value: unknown): TwseDailyIndex[] {
  if (!value || typeof value !== 'object') throw new Error('TWSE 回應必須是物件');
  const response = value as TwseResponse;
  if (response.stat !== 'OK') throw new Error(`TWSE 回應狀態異常: ${response.stat ?? 'missing'}`);
  if (!Array.isArray(response.fields) || !Array.isArray(response.data)) throw new Error('TWSE 回應缺少 fields 或 data');
  const fields = response.fields.map(String);
  const positions = ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'].map((field) => fields.indexOf(field));
  if (positions.some((position) => position < 0)) throw new Error('TWSE 欄位格式不符預期');
  return response.data.map((raw, index) => {
    if (!Array.isArray(raw)) throw new Error(`TWSE 第 ${index + 1} 列格式錯誤`);
    return {
      date: parseRocDate(String(raw[positions[0]])),
      open: parseTwseNumber(raw[positions[1]]),
      high: parseTwseNumber(raw[positions[2]]),
      low: parseTwseNumber(raw[positions[3]]),
      close: parseTwseNumber(raw[positions[4]])
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchTwseMonth(date: string, fetcher: typeof fetch = fetch): Promise<TwseDailyIndex[]> {
  const dateParameter = date.replaceAll('-', '');
  return withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${ENDPOINT}?response=json&date=${dateParameter}`, {
        // TWSE may return its HTML landing page to generic bot user agents even
        // when response=json is requested. A curl-compatible agent consistently
        // receives the documented JSON representation.
        headers: { Accept: 'application/json', 'User-Agent': 'curl/8.7.1' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`TWSE HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('json')) throw new Error(`TWSE 回傳非 JSON (${contentType || 'unknown content type'})`);
      return parseTwseHistory(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }, { onRetry: (error, retry, delay) => console.warn(`TWSE retry ${retry}/3 in ${delay}ms: ${error instanceof Error ? error.message : error}`) });
}

export function previousMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 2, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function findTwseOutcomeRows(date: string, fetcher: typeof fetch = fetch): Promise<{
  today: TwseDailyIndex;
  previous: TwseDailyIndex;
} | null> {
  const current = await fetchTwseMonth(date, fetcher);
  const todayIndex = current.findIndex((row) => row.date === date);
  if (todayIndex < 0) return null;
  if (todayIndex > 0) return { today: current[todayIndex], previous: current[todayIndex - 1] };
  const prior = await fetchTwseMonth(previousMonth(date), fetcher);
  const previous = prior.at(-1);
  return previous ? { today: current[todayIndex], previous } : null;
}
