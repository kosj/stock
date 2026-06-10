/**
 * async-pool — 서버리스(Vercel) 타임아웃 방어용 동시성 제어 프리미티브
 *
 * 설계 배경:
 *   Vercel 함수는 실행 시간(maxDuration)과 동시 소켓 수에 제약이 있다.
 *   91개 종목에 대해 외부 API(Naver 크롤링·Hugging Face 추론·Supabase)를
 *   `Promise.all`로 한꺼번에 던지면 다음 두 문제가 동시에 터진다.
 *     1) 외부 서버(Naver/HF)가 동시 폭주를 감지해 429/503으로 차단(rate-limit)
 *     2) 수십 개 소켓이 동시에 열려 메모리·이벤트 루프 압박 → 콜드스타트 악화
 *
 *   반대로 완전 직렬(for-await)로 돌리면 안전하지만 60초 타임아웃을 넘긴다.
 *
 *   → 해법: "워커 풀(worker pool)" 패턴. 항상 정확히 `limit`개의 작업만
 *     동시에 진행하고, 하나가 끝나면 다음 작업을 즉시 당겨온다.
 *     처리량(throughput)과 안정성(차단 회피)을 동시에 잡는 표준 기법.
 */

/**
 * 동시성을 `limit`개로 제한하면서 배열을 비동기 매핑한다.
 *
 * `Promise.allSettled`와 동일하게 **개별 실패가 전체를 중단시키지 않는다**.
 * 각 원소의 결과는 입력과 동일한 인덱스 위치에 `PromiseSettledResult`로 보존된다.
 *
 * @typeParam T - 입력 원소 타입
 * @typeParam R - 워커 반환 타입
 * @param items  - 처리할 입력 배열 (읽기 전용)
 * @param limit  - 동시에 실행할 최대 워커 수 (예: 8 → 항상 최대 8개 in-flight)
 * @param worker - 각 원소를 처리하는 비동기 함수 `(item, index) => Promise<R>`
 * @returns 입력 순서와 1:1 대응하는 `PromiseSettledResult<R>[]`
 *
 * @example
 * const settled = await mapWithConcurrency(tickers, 8, t => fetchSentiment(t));
 * settled.forEach((r, i) => {
 *   if (r.status === "fulfilled") use(r.value);
 *   else console.warn(`${tickers[i]} 실패:`, r.reason);
 * });
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);

  // 공유 커서: 모든 워커가 이 인덱스를 원자적으로(단일 스레드 보장) 당겨 쓴다.
  let cursor = 0;

  // 풀 크기는 limit과 실제 작업 수 중 작은 값 (작업보다 많은 워커는 무의미)
  const poolSize = Math.max(1, Math.min(limit, items.length));

  const runWorker = async (): Promise<void> => {
    // 워커는 더 이상 가져올 작업이 없을 때까지 큐를 비운다.
    for (let i = cursor++; i < items.length; i = cursor++) {
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: poolSize }, runWorker));
  return results;
}

/**
 * 프라미스에 하드 타임아웃을 건다. 지정 시간 내에 settle되지 않으면 reject.
 *
 * 서버리스에서 외부 호출(특히 콜드 상태의 HF 모델 로딩, 느린 크롤링 대상)이
 * 무한정 매달리면 함수 전체가 타임아웃으로 죽는다. 개별 호출을 짧게 끊어
 * "실패는 빠르게(fail-fast), 전체는 살린다(graceful degrade)"를 보장한다.
 *
 * @typeParam T - 원본 프라미스 결과 타입
 * @param promise - 감쌀 프라미스
 * @param ms      - 타임아웃(밀리초)
 * @param label   - 타임아웃 식별용 라벨 (에러 메시지 `timeout:<label>`)
 * @returns 원본이 제때 끝나면 그 값, 아니면 `timeout:<label>`로 reject
 *
 * @remarks
 * 타이머 누수를 막기 위해 원본이 먼저 끝나면 `clearTimeout`으로 정리한다.
 * (단, 원본 프라미스 자체는 취소되지 않는다 — JS 프라미스는 취소 불가.
 *  fetch 취소가 필요하면 AbortController를 별도로 사용할 것.)
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
