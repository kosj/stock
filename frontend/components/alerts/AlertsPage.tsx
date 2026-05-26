"use client";
import { useState, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/utils";
import { Bell, BellOff, Plus, Trash2, Target, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Alert = {
  id: number;
  ticker: string;
  alert_type: string;
  direction: string;
  threshold: number;
  is_active: boolean;
  position_id?: number | null;
  message?: string | null;
  created_at: string;
};

type PositionWithTarget = {
  id: number;
  portfolio_id: number;
  ticker: string;
  name: string;
  quantity: number;
  avg_price: number;
  stop_loss: number | null;
  take_profit: number | null;
};

// ── 푸시 알림 활성화 ──────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function AlertsPage() {
  const [pushEnabled, setPushEnabled]     = useState(false);
  const [pushLoading, setPushLoading]     = useState(false);
  const [showAdd,     setShowAdd]         = useState(false);
  const [addingAlert, setAddingAlert]     = useState<string | null>(null);
  const [form, setForm] = useState({
    ticker: "", alert_type: "custom", direction: "below", threshold: "",
  });

  const { data: alerts, mutate: mutateAlerts } = useSWR<Alert[]>(
    "alerts",
    () => api.push.alerts() as Promise<Alert[]>,
  );
  const alertList = alerts ?? [];

  const { data: positions } = useSWR<PositionWithTarget[]>(
    "positions-with-targets",
    () => api.portfolio.allPositionsWithTargets() as Promise<PositionWithTarget[]>,
    { revalidateOnFocus: false },
  );
  const positionList = positions ?? [];

  useEffect(() => {
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  // ── 푸시 활성화 ─────────────────────────────────────────────────────────────

  async function enablePush() {
    if (!("Notification" in window)) {
      toast.error("이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("알림 권한이 거부되었습니다.");
        return;
      }

      // Service Worker 등록 (sw.js가 없거나 실패해도 알림 권한은 유지)
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const { public_key } = await api.push.vapidKey();
        if (public_key) {
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key).buffer as ArrayBuffer,
          });
          const json = sub.toJSON();
          await api.push.subscribe({
            endpoint: json.endpoint!,
            p256dh: json.keys!.p256dh,
            auth:   json.keys!.auth,
          });
          toast.success("웹 푸시 알림이 활성화되었습니다.");
        } else {
          toast.success("알림 권한이 허용되었습니다. (앱 내 알림 모드)");
        }
      } catch {
        // 서비스 워커 실패해도 브라우저 알림 권한은 얻었으므로 성공 처리
        toast.success("알림 권한이 허용되었습니다.");
      }

      setPushEnabled(true);
    } catch (e: unknown) {
      toast.error("알림 설정 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPushLoading(false);
    }
  }

  // ── 알림 추가 (수동 폼) ──────────────────────────────────────────────────────

  async function addAlert(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.push.createAlert({
        ticker:     form.ticker.toUpperCase(),
        alert_type: form.alert_type,
        direction:  form.direction,
        threshold:  Number(form.threshold),
      });
      await mutateAlerts();
      setShowAdd(false);
      setForm({ ticker: "", alert_type: "custom", direction: "below", threshold: "" });
      toast.success("알림 추가 완료");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "오류 발생");
    }
  }

  // ── 보유 종목 알림 추가 (원클릭) ──────────────────────────────────────────────

  async function addPositionAlert(
    pos: PositionWithTarget,
    type: "stop_loss" | "take_profit",
  ) {
    const threshold = type === "stop_loss" ? pos.stop_loss : pos.take_profit;
    if (!threshold) return;

    const key = `${pos.ticker}_${type}`;
    setAddingAlert(key);
    try {
      await api.push.createAlert({
        ticker:      pos.ticker,
        alert_type:  type,
        direction:   type === "stop_loss" ? "below" : "above",
        threshold,
        position_id: pos.id,
        message:     `${pos.name} ${type === "stop_loss" ? "손절가" : "목표가"} ${formatNumber(threshold)}원`,
      });
      await mutateAlerts();
      toast.success(
        `${pos.name} ${type === "stop_loss" ? "손절가" : "목표가"} 알림 추가됨`,
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "오류 발생");
    } finally {
      setAddingAlert(null);
    }
  }

  // ── 알림 삭제 ────────────────────────────────────────────────────────────────

  async function deleteAlert(id: number) {
    try {
      await api.push.deleteAlert(id);
      await mutateAlerts();
      toast.success("알림 삭제");
    } catch {
      toast.error("삭제 실패");
    }
  }

  // ── 중복 체크 ────────────────────────────────────────────────────────────────

  function hasAlert(ticker: string, type: string) {
    return alertList.some(
      (a) => a.ticker === ticker && a.alert_type === type && a.is_active,
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">알림 설정</h1>

      {/* ── 웹 푸시 활성화 ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>웹 푸시 알림</CardTitle>
          {pushEnabled ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <Bell size={13} /> 활성화됨
            </span>
          ) : (
            <Button size="sm" onClick={enablePush} disabled={pushLoading}>
              <Bell size={13} />
              {pushLoading ? "설정 중..." : "알림 활성화"}
            </Button>
          )}
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          손절가·목표가 도달 시 브라우저 알림을 받습니다. 모바일에서 홈화면에 추가(PWA)하면 앱 알림처럼 동작합니다.
        </p>
      </Card>

      {/* ── 보유 종목 알림 설정 ────────────────────────────────────── */}
      {positionList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>보유 종목 알림</CardTitle>
            <span className="text-xs text-muted-foreground">
              손절가·목표가가 설정된 보유 종목에서 바로 알림을 추가할 수 있습니다.
            </span>
          </CardHeader>

          <div className="space-y-0">
            {positionList.map((pos) => {
              const hasStop   = !!pos.stop_loss;
              const hasTarget = !!pos.take_profit;
              const stopAdded   = hasAlert(pos.ticker, "stop_loss");
              const targetAdded = hasAlert(pos.ticker, "take_profit");

              return (
                <div
                  key={pos.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  {/* 종목 정보 */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{pos.name}</span>
                      <span className="text-xs text-muted-foreground">{pos.ticker}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      평균 {formatNumber(pos.avg_price)}원 · {pos.quantity}주
                    </div>
                  </div>

                  {/* 알림 버튼들 */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* 손절가 */}
                    {hasStop && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-blue-400">
                          <ShieldAlert size={11} className="inline mr-0.5" />
                          손절 {formatNumber(pos.stop_loss!)}원
                        </span>
                        {stopAdded ? (
                          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
                            추가됨
                          </span>
                        ) : (
                          <button
                            onClick={() => addPositionAlert(pos, "stop_loss")}
                            disabled={addingAlert === `${pos.ticker}_stop_loss`}
                            className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                          >
                            + 알림
                          </button>
                        )}
                      </div>
                    )}
                    {/* 목표가 */}
                    {hasTarget && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-red-400">
                          <Target size={11} className="inline mr-0.5" />
                          목표 {formatNumber(pos.take_profit!)}원
                        </span>
                        {targetAdded ? (
                          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
                            추가됨
                          </span>
                        ) : (
                          <button
                            onClick={() => addPositionAlert(pos, "take_profit")}
                            disabled={addingAlert === `${pos.ticker}_take_profit`}
                            className="text-xs px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                          >
                            + 알림
                          </button>
                        )}
                      </div>
                    )}
                    {!hasStop && !hasTarget && (
                      <span className="text-xs text-muted-foreground/50">
                        손절가·목표가 미설정
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── 가격 알림 목록 ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>가격 알림</CardTitle>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={13} /> 알림 추가
          </Button>
        </CardHeader>

        {/* 수동 추가 폼 */}
        {showAdd && (
          <form
            onSubmit={addAlert}
            className="mb-4 p-3 rounded-lg border space-y-3"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">종목코드</label>
                <input
                  required
                  value={form.ticker}
                  onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))}
                  placeholder="005930"
                  className="w-full bg-muted px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">알림 유형</label>
                <select
                  value={form.alert_type}
                  onChange={(e) => setForm((f) => ({ ...f, alert_type: e.target.value }))}
                  className="w-full bg-muted px-3 py-2 rounded text-sm focus:outline-none"
                >
                  <option value="stop_loss">손절가</option>
                  <option value="take_profit">목표가</option>
                  <option value="custom">커스텀</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">조건</label>
                <select
                  value={form.direction}
                  onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                  className="w-full bg-muted px-3 py-2 rounded text-sm focus:outline-none"
                >
                  <option value="below">이하로 하락 시</option>
                  <option value="above">이상으로 상승 시</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">기준가 (원)</label>
                <input
                  required
                  type="number"
                  value={form.threshold}
                  onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="70000"
                  className="w-full bg-muted px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                취소
              </Button>
              <Button type="submit" size="sm">추가</Button>
            </div>
          </form>
        )}

        {/* 알림 목록 */}
        {alertList.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <BellOff size={20} className="mx-auto mb-2 opacity-40" />
            등록된 알림이 없습니다.
          </div>
        ) : (
          <div className="space-y-0">
            {alertList.map((a) => {
              const typeLabel =
                a.alert_type === "stop_loss"   ? "손절가" :
                a.alert_type === "take_profit" ? "목표가" : "커스텀";
              const dirLabel = a.direction === "below" ? "이하 하락" : "이상 상승";
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-3 border-b last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.ticker}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        a.alert_type === "stop_loss"
                          ? "bg-blue-500/15 text-blue-400"
                          : a.alert_type === "take_profit"
                          ? "bg-red-500/15 text-red-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {typeLabel}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatNumber(a.threshold)}원 {dirLabel}
                      {a.message && (
                        <span className="ml-1 text-muted-foreground/60">· {a.message}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${a.is_active ? "text-green-400" : "text-muted-foreground"}`}>
                      {a.is_active ? "활성" : "완료"}
                    </span>
                    <button
                      onClick={() => deleteAlert(a.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
