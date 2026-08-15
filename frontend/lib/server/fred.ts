// FRED API (Federal Reserve Economic Data) — direct HTTP

const BASE = "https://api.stlouisfed.org/fred/series/observations";

type FredObs = { date: string; value: string };

interface SeriesResult {
  name: string;
  value: number;
  prev_value: number;
  change: number;
  change_pct: number;
  unit: string;
  date: string;
  series: { date: string; value: number }[];
}

async function fetchFred(
  seriesId: string,
  name: string,
  unit: string,
  apiKey: string,
  limit = 60
): Promise<SeriesResult | null> {
  if (!apiKey) return null;
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 3);
    const url =
      `${BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json` +
      `&sort_order=asc&observation_start=${startDate.toISOString().slice(0, 10)}`;

    // 타임아웃이 없으면 FRED 지연이 라우트 전체(maxDuration)를 잡아먹는다
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const obs: FredObs[] = (json.observations ?? []).filter(
      (o: FredObs) => o.value !== "." && !isNaN(Number(o.value))
    );
    if (obs.length === 0) return null;

    const tail = obs.slice(-limit);
    const current = Number(tail[tail.length - 1].value);
    const prev = Number(tail[tail.length - 2]?.value ?? current);
    const change = current - prev;

    return {
      name,
      value: round(current, 4),
      prev_value: round(prev, 4),
      change: round(change, 4),
      change_pct: prev ? round((change / prev) * 100, 4) : 0,
      unit,
      date: tail[tail.length - 1].date,
      series: tail.map((o) => ({ date: o.date, value: round(Number(o.value), 4) })),
    };
  } catch {
    return null;
  }
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export async function getMacroDashboard(fredApiKey: string): Promise<Record<string, SeriesResult | null>> {
  const [
    usFedRate, us10y, krBaseRate, usCpi, krCpi,
  ] = await Promise.allSettled([
    fetchFred("FEDFUNDS",        "미국 기준금리",   "%",      fredApiKey),
    fetchFred("DGS10",           "미국 10년 국채",  "%",      fredApiKey),
    fetchFred("INTDSRKRM193N",   "한국 기준금리",   "%",      fredApiKey),
    fetchFred("CPIAUCSL",        "미국 CPI",        "index",  fredApiKey),
    fetchFred("KORCPIALLMINMEI", "한국 CPI",        "index",  fredApiKey),
  ]);

  const get = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);

  return {
    us_fed_rate:  get(usFedRate),
    us_10y_yield: get(us10y),
    kr_base_rate: get(krBaseRate),
    us_cpi:       get(usCpi),
    kr_cpi:       get(krCpi),
  };
}
