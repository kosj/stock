import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { updateAccount } from "@/lib/server/mock-account-control";
export const dynamic = "force-dynamic";
export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try { return NextResponse.json(await updateAccount(auth.userId, {}, true)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "초기화 실패" }, { status: 409 }); }
}
