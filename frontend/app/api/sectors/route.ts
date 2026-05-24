import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      return NextResponse.json(
        {
          error: "Backend not configured",
          message: "NEXT_PUBLIC_BACKEND_URL 환경 변수를 설정하세요",
        },
        { status: 502 }
      );
    }

    const url = new URL(request.url);
    const fullUrl = `${backendUrl}${url.pathname}${url.search}`;

    const response = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Sectors API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
