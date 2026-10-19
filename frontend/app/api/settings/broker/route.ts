import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { ApiInputError, readBoundedJson } from "@/lib/server/api-security-policy";
import { saveBrokerConfig, listBrokerTypes } from "@/lib/server/broker-config";

export const dynamic = "force-dynamic";

/** 설정된 증권사 목록 조회 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const configured = await listBrokerTypes(auth.userId);
  return NextResponse.json({ configured });
}

/** 증권사 자격증명 저장 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    const value = await readBoundedJson(req, 8192);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiInputError("JSON object required");
    body = value as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: "유효한 설정 요청이 필요합니다." }, { status: error instanceof ApiInputError ? error.status : 400 });
  }
  const { type, appKey, appSecret, accountNumber, isDemo } = body;

  // 서버 측에서도 trim — 클라이언트 처리 실패 시 방어
  const cleanKey    = String(appKey    ?? "").trim();
  const cleanSecret = String(appSecret ?? "").trim();
  const cleanAcct   = String(accountNumber ?? "").replace(/[\s]/g, ""); // 계좌번호는 공백만 제거

  if (type !== "kis" || typeof appKey !== "string" || typeof appSecret !== "string" || !cleanKey || !cleanSecret
    || cleanKey.length > 512 || cleanSecret.length > 2048 || (accountNumber !== undefined && typeof accountNumber !== "string")
    || (cleanAcct && !/^\d{8}(?:-?\d{2})?$/.test(cleanAcct)) || (isDemo !== undefined && typeof isDemo !== "boolean")) {
    return NextResponse.json({ error: "type, appKey, appSecret 필드가 필요합니다." }, { status: 400 });
  }

  try {
    await saveBrokerConfig(auth.userId, type, {
      appKey:        cleanKey,
      appSecret:     cleanSecret,
      accountNumber: cleanAcct || undefined,
      isDemo: isDemo === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
