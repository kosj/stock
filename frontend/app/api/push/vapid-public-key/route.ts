import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // 샘플 VAPID 공개 키
    // 실제 환경에서는 환경 변수에서 로드해야 함
    const publicKey = process.env.NEXT_PUBLIC_VAPID_KEY ||
      "BEiGLZN3w0H6T5hs4kcWbCjHYqh8x5m7p8q9r0s1t2u3v4w5x6y7z8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1";

    return NextResponse.json({
      public_key: publicKey
    });
  } catch (error) {
    console.error("Push vapid-key API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
