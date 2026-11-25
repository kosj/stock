import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/server/read-json";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const [auth, { id }] = await Promise.all([requireUser(), params]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, description, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return error.code === "PGRST116"
      ? NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 })
      : dbErrorResponse(error, "portfolio/[id] GET", "포트폴리오를 불러오지 못했습니다.");
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const [auth, { id }, parsed] = await Promise.all([requireUser(), params, readJsonObject(req)]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;
  if (!parsed.ok) return parsed.response;
  const { name, description } = parsed.body;
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 100))
    return NextResponse.json({ error: "포트폴리오 이름은 1~100자여야 합니다." }, { status: 400 });
  if (description !== undefined && description !== null && typeof description !== "string")
    return NextResponse.json({ error: "설명은 문자열이어야 합니다." }, { status: 400 });

  const { data, error } = await supabase
    .from("portfolios")
    .update({ name, description, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, name, description, created_at, updated_at")
    .single();

  if (error) return dbErrorResponse(error, "portfolio/[id] PUT", "포트폴리오를 수정하지 못했습니다.");
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const [auth, { id }] = await Promise.all([requireUser(), params]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { error } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return dbErrorResponse(error, "portfolio/[id] DELETE", "포트폴리오를 삭제하지 못했습니다.");
  return new NextResponse(null, { status: 204 });
}
