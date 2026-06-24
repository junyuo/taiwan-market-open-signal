import { withRetry } from './retry';

export interface FredObservation {
  date: string;
  value: number;
}

export async function fetchFredSeries(seriesId: string, apiKey: string): Promise<FredObservation[]> {
  return withRetry(async () => {
    const url = new URL('https://api.stlouisfed.org/fred/series/observations');
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', '10');
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`FRED HTTP ${response.status}`);
    const payload = (await response.json()) as { observations?: Array<{ date: string; value: string }> };
    return (payload.observations ?? [])
      .filter((item) => item.value !== '.' && Number.isFinite(Number(item.value)))
      .map((item) => ({ date: item.date, value: Number(item.value) }));
  }, { retries: 3, delaysMs: [1_000, 3_000, 9_000] });
}
