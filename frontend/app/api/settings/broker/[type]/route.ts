import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { deleteBrokerConfig } from "@/lib/server/broker-config";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ type: string }> };

/** 증권사 자격증명 삭제 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { type } = await params;
  if (type !== "kis") return NextResponse.json({ error: "지원하지 않는 증권사" }, { status: 400 });
  try {
    await deleteBrokerConfig(auth.userId, type);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "삭제 실패" }, { status: 500 }); }
}
