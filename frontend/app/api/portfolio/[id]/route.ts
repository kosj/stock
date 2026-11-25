import { NextRequest, NextResponse } from "next/server";
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
  const [auth, { id }, body] = await Promise.all([requireUser(), params, req.json()]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data, error } = await supabase
    .from("portfolios")
    .update({ name: body.name, description: body.description, updated_at: new Date().toISOString() })
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
