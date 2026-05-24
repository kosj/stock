import { NextRequest, NextResponse } from "next/server";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType, BrokerCredentials } from "@/lib/server/providers";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { broker, appKey, appSecret } = body;

    if (!broker || !appKey || !appSecret) {
      return NextResponse.json(
        { error: "Missing broker credentials" },
        { status: 400 }
      );
    }

    const credentials: BrokerCredentials = {
      appKey,
      appSecret
    };

    const provider = createBrokerProvider(broker as BrokerType, credentials);
    const indices = await provider.getIndices();

    return NextResponse.json(indices, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error("Broker indices API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
