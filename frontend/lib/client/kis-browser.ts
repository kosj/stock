/** Compatibility wrapper: browser code never calls KIS or stores bearer tokens. */
import type { BrokerCredentials, BrokerHolding } from "@/lib/server/providers";

export async function getKisPositions(creds: BrokerCredentials): Promise<BrokerHolding[]> {
  void creds; // Environment and credentials come from the authenticated server config.
  const res = await fetch("/api/broker/holdings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "보유종목 조회 실패. 설정 → API 설정에서 증권사 키를 등록해주세요.");
  return data.holdings;
}
