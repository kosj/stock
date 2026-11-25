import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/server/read-json";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, description, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return dbErrorResponse(error, "portfolio GET", "포트폴리오 목록을 불러오지 못했습니다.");
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const { name, description } = parsed.body;
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    return NextResponse.json({ error: "포트폴리오 이름(1~100자)이 필요합니다." }, { status: 400 });
  if (description != null && typeof description !== "string")
    return NextResponse.json({ error: "설명은 문자열이어야 합니다." }, { status: 400 });
  const { data, error } = await supabase
    .from("portfolios")
    .insert({ name, description: description ?? null, user_id: userId })
    .select("id, name, description, created_at, updated_at")
    .single();

  if (error) return dbErrorResponse(error, "portfolio POST", "포트폴리오를 만들지 못했습니다.");
  return NextResponse.json(data, { status: 201 });
}
