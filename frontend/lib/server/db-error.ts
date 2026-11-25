/**
 * DB 오류 → 클라이언트 응답 변환.
 *
 * Supabase/PostgREST 의 error.message 에는 테이블·컬럼·제약 이름과 질의 내부가
 * 들어 있다("duplicate key value violates unique constraint ...",
 * "JSON object requested, multiple (or no) rows returned" 등). 이걸 그대로
 * 응답에 실으면 런타임 내부를 노출하고, 사용자에겐 읽을 수 없는 문구가 된다.
 *
 * 원문은 서버 로그에만 남기고 클라이언트엔 일반 문구 + PostgREST code 만 준다.
 * code(23505, PGRST116 …)는 민감하지 않고 문의 시 원인 추적에 쓰인다.
 * 로그에도 code/message 만 남기고 details·hint·질의 행은 남기지 않는다
 * (scripts/price_store.py 의 RPC 실패 보고 규약과 동일).
 *
 * 사용자가 알아야 하는 업무 오류(권한 없음, 중복, 입력 무효)는 이 함수 전에
 * 호출부가 code/메시지로 먼저 분기해 구체적인 4xx 로 돌려준다 —
 * positions/replace 라우트가 그 기준 패턴이다.
 */
import { NextResponse } from "next/server";

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

export function dbErrorResponse(
  error: DbErrorLike,
  context: string,
  userMessage = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  status = 500,
): NextResponse {
  console.error(`[${context}] db error code=${error.code ?? "-"} message=${error.message ?? ""}`);
  return NextResponse.json({ error: userMessage, code: error.code ?? null }, { status });
}
