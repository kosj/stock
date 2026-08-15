import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "-";
  if (Math.abs(n) >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}조`;
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return formatNumber(n);
}

export function formatPercent(n: number | null | undefined, digits = 2): string {
  if (n == null) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/**
 * 등락 색상 규약 — 앱 전체가 이 한 곳을 따른다.
 *
 * true  = 한국 HTS 관행(상승 빨강 / 하락 파랑)
 * false = 서구 관행(상승 초록 / 하락 빨강)  ← 현재 앱 대부분이 이 방식
 *
 * 이전에는 KRX 화면만 한국 관행, 나머지는 서구 관행이라 같은 앱에서 같은
 * 부호가 정반대 색으로 보였다. 바꾸려면 이 상수만 true로 두면 전체가 바뀐다.
 */
export const KR_COLOR_CONVENTION = false;

export function colorByChange(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  if (KR_COLOR_CONVENTION) {
    if (n > 0) return "text-red-400";
    if (n < 0) return "text-blue-400";
    return "text-muted-foreground";
  }
  if (n > 0) return "text-green-400";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

export function recommendationColor(rec: string): string {
  switch (rec) {
    case "Strong Buy": return "bg-green-600 text-white";
    case "Buy":        return "bg-green-500/20 text-green-400";
    case "Hold":       return "bg-yellow-500/20 text-yellow-400";
    case "Sell":       return "bg-red-500/20 text-red-400";
    case "Strong Sell":return "bg-red-700 text-white";
    default:           return "bg-muted text-muted-foreground";
  }
}
