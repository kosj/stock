import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.APP_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  return NextResponse.json(
    { status: "ok", version: "1.0.0", commit_sha: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
