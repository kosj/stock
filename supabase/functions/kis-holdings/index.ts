// Retired anonymous credential proxy. Remove the old deployment after release.
// The authenticated Next.js /api/broker/holdings route loads server-stored keys.
Deno.serve(() => new Response(
  JSON.stringify({ error: "이 프록시는 종료되었습니다. 인증된 /api/broker/holdings를 사용하세요." }),
  { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
));
