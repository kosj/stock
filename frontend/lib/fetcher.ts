/**
 * 공통 SWR fetcher + 상태 헬퍼
 * ============================================================================
 * 왜 필요한가:
 *   화면마다 fetcher를 따로 정의하면서 실패 처리가 제각각이 됐고, 그 결과
 *   `if (!res.ok) return []` 같은 코드가 여러 곳에 생겼다. 이 패턴은 서버
 *   장애를 "데이터 0건"으로 위장해, 사용자가 실패를 인지하지 못한 채
 *   "신호 없음"으로 읽게 만든다(매매 판단에 쓰이는 화면에서 특히 위험).
 *
 *   여기서는 실패를 반드시 throw 한다. SWR이 error 상태로 전달하므로
 *   화면은 로딩/에러/빈 데이터를 구분해 표시할 수 있다.
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** 표준 JSON fetcher — 실패는 ApiError로 throw (빈 값으로 위장하지 않는다) */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? body?.detail ?? "";
    } catch { /* 본문이 JSON이 아닐 수 있다 */ }
    throw new ApiError(res.status, detail || `요청 실패 (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** POST JSON fetcher — SWR key가 [url, body] 형태일 때 사용 */
export async function postFetcher<T = unknown>([url, body]: [string, unknown]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `요청 실패 (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** 사용자에게 보여줄 에러 문구 — 상태코드별로 원인을 구분해 안내 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "로그인이 필요합니다.";
    if (err.status === 403) return "접근 권한이 없습니다.";
    if (err.status === 503) return "외부 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return err.message;
  }
  return err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
}
