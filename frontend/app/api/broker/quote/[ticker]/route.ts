import { NextRequest, NextResponse } from "next/server";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType, BrokerCredentials } from "@/lib/server/providers";

export const dynamic     = "force-dynamic";
export const maxDuration = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
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
    const quote = await provider.getQuote(ticker);

    return NextResponse.json(quote, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error("Broker quote API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
