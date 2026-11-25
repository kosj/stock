/**
 * 증권사 연동 상태 조회 — SWR 캐시를 공유하는 화면들의 단일 fetcher.
 *
 * 같은 SWR 키를 여러 화면이 쓰면 fetcher 도 하나여야 한다. 예전엔
 * BrokerSettingsPage 는 실패 시 throw 하고 PortfolioPage 는 [] 로 위장해,
 * 포트폴리오를 먼저 연 상태에서 API 가 실패하면 [] 가 공유 캐시에 들어갔다.
 * 그 뒤 설정 화면으로 가면 캐시에서 "등록된 계정 없음"이 떴다 — 장애를
 * "미연동"으로 보여 사용자가 멀쩡한 키를 다시 등록하게 만든다.
 */
import { ApiError } from "@/lib/fetcher";

export const BROKER_CONFIGURED_KEY = "broker-settings-configured";

export async function fetchConfiguredBrokers(): Promise<string[]> {
  const res = await fetch("/api/settings/broker");
  // 실패를 빈 목록으로 위장하면 '등록된 계정 없음'으로 오해된다
  if (!res.ok) throw new ApiError(res.status, `요청 실패 (HTTP ${res.status})`);
  const data: { configured?: string[] } = await res.json();
  return data.configured ?? [];
}
