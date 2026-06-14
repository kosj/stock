/**
 * KrMarketClock — ClockPort 구현 (한국 증시 KRX 정규장 기준)
 *
 * KST(UTC+9) 기준. 정규장 09:00~15:30, 월~금.
 * ⚠ 공휴일/임시휴장은 미반영 (추후 거래소 캘린더 연동 필요 — Phase 3+).
 */

import type { ClockPort } from "@/lib/core/ports/clock-port";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const OPEN_MIN  = 9 * 60;        // 09:00
const CLOSE_MIN = 15 * 60 + 30;  // 15:30

export class KrMarketClock implements ClockPort {
  now(): Date {
    return new Date();
  }

  /** UTC Date를 KST 벽시계로 환산한 Date (getUTC* 로 KST 값 읽기) */
  private toKst(d: Date): Date {
    return new Date(d.getTime() + KST_OFFSET_MS);
  }

  isTradingDay(d: Date = this.now()): boolean {
    const day = this.toKst(d).getUTCDay(); // 0=일 … 6=토
    return day >= 1 && day <= 5;
  }

  isMarketOpen(d: Date = this.now()): boolean {
    if (!this.isTradingDay(d)) return false;
    const k = this.toKst(d);
    const mins = k.getUTCHours() * 60 + k.getUTCMinutes();
    return mins >= OPEN_MIN && mins <= CLOSE_MIN;
  }

  tradingDateKst(d: Date = this.now()): string {
    // KST 벽시계 날짜를 YYYYMMDD로
    return this.toKst(d).toISOString().slice(0, 10).replace(/-/g, "");
  }
}
