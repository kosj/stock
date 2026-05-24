import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 웹 푸시 구독 정보를 저장 (실제 환경에서는 데이터베이스에 저장)
    // const subscription = body;
    // await saveSubscriptionToDatabase(subscription);

    return NextResponse.json({
      success: true,
      message: "구독이 완료되었습니다."
    }, { status: 201 });
  } catch (error) {
    console.error("Push subscribe API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
