/**
 * readJsonObject — API 라우트 본문 읽기 게이트 (requireUser 와 같은 형태).
 *
 * `await req.json()` 은 본문 크기 제한이 없고, 잘못된 JSON 이면 예외가 그대로
 * 올라가 500 이 된다. 서버리스에서 무제한 본문은 메모리·실행시간 공격면이다.
 * readBoundedJson(8KB 상한, 잘못된 JSON → 400, 초과 → 413)이 이미 있었지만
 * 12개 본문 라우트 중 3곳만 쓰고 있었다. 라우트마다 7줄씩 복붙하는 대신
 * 결과를 판별 유니온으로 돌려준다:
 *
 *   const parsed = await readJsonObject(req);
 *   if (!parsed.ok) return parsed.response;   // 400 / 413
 *   const body = parsed.body;                  // Record<string, unknown>
 *
 * 예외를 던지지 않으므로 Promise.all 안에서 인증과 병렬로 읽어도 된다.
 * (본문은 8KB 로 묶여 있어 인증 전에 읽어도 비용이 제한된다)
 */
import { NextResponse } from "next/server";
import { ApiInputError, readBoundedJson } from "./api-security-policy";

export type JsonObjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export async function readJsonObject(
  req: Request,
  {
    maxBytes = 8192,
    /**
     * 본문 없는 요청을 {} 로 받는다. 기존 계약이 "본문 선택"인 라우트용
     * (예: auto-fill — 화면이 { method: "POST" } 로 본문 없이 호출한다).
     */
    allowEmpty = false,
  }: { maxBytes?: number; allowEmpty?: boolean } = {},
): Promise<JsonObjectResult> {
  if (allowEmpty && (req.body === null || req.headers.get("content-length") === "0")) {
    return { ok: true, body: {} };
  }
  try {
    const value = await readBoundedJson(req, maxBytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiInputError("JSON object required");
    }
    return { ok: true, body: value as Record<string, unknown> };
  } catch (error) {
    const status = error instanceof ApiInputError ? error.status : 400;
    const message = status === 413 ? "요청 본문이 너무 큽니다." : "유효한 JSON 객체가 필요합니다.";
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }
}
