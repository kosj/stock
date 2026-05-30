import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getCurrentUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET(_: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { data, error } = await supabase
    .from("portfolios")
    .update({ name: body.name, description: body.description, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const { error } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
