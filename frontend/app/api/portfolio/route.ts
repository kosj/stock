import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireApprovedUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

// Approved role is checked here as well as in middleware (defence in depth).
async function getCurrentUserId(): Promise<string | null> {
  const auth = await requireApprovedUser();
  return auth.ok ? auth.userId : null;
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, description, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await req.json();
  const { data, error } = await supabase
    .from("portfolios")
    .insert({ name: body.name, description: body.description ?? null, user_id: userId })
    .select("id, name, description, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
