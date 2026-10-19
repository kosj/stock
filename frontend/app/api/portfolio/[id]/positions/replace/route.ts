import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { supabase } from "@/lib/server/supabase";
import { ApiInputError, readBoundedJson } from "@/lib/server/api-security-policy";
import { parsePortfolioImport } from "@/lib/server/portfolio-import-policy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807"))
    return NextResponse.json({ error: "잘못된 포트폴리오 ID" }, { status: 400 });
  try {
    const positions = parsePortfolioImport(await readBoundedJson(req, 64 * 1024));
    const { data, error } = await supabase.rpc("replace_portfolio_positions", {
      p_user_id: auth.userId, p_portfolio_id: id, p_positions: positions,
    });
    if (error) {
      if (error.message.includes("permission_denied")) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
      if (/invalid_position|duplicate_ticker|unknown_position_field|positions_limit/.test(error.message))
        return NextResponse.json({ error: "가져오기 데이터가 유효하지 않습니다. 기존 포지션은 유지됩니다." }, { status: 400 });
      return NextResponse.json({ error: "가져오기 결과를 확인하지 못했습니다. 새로고침하여 현재 포지션을 확인하세요." }, { status: 503 });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ApiInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "가져오기 결과를 확인하지 못했습니다. 새로고침하여 현재 포지션을 확인하세요." }, { status: 503 });
  }
}
