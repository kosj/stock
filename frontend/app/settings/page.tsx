import { BrokerSettingsPage } from "@/components/settings/BrokerSettingsPage";

export const metadata = {
  title: "증권사 API 설정",
  description: "한국투자증권 등의 증권사 API를 설정하여 실시간 시장 데이터를 수집합니다.",
};

export default function SettingsPage() {
  return <BrokerSettingsPage />;
}
