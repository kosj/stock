"use client";
import { useState, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/utils";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function AlertsPage() {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    ticker: "", alert_type: "custom", direction: "below", threshold: "",
  });

  const { data: alerts, mutate } = useSWR("alerts", () => api.push.alerts());
  const alertList = alerts as any[] ?? [];

  useEffect(() => {
    if ("Notification" in window && "serviceWorker" in navigator) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

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

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { public_key } = await api.push.vapidKey();
      if (!public_key) {
        toast.info("VAPID 키가 설정되지 않았습니다. .env에서 설정하세요.");
        setPushEnabled(true);
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key).buffer as ArrayBuffer,
      });

      const json = sub.toJSON();
      await api.push.subscribe({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      });

      setPushEnabled(true);
      toast.success("알림이 활성화되었습니다.");
    } catch (e: any) {
      toast.error("알림 설정 실패: " + e.message);
    } finally {
      setPushLoading(false);
    }
  }

  async function addAlert(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.push.createAlert({
        ticker: form.ticker.toUpperCase(),
        alert_type: form.alert_type,
        direction: form.direction,
        threshold: Number(form.threshold),
      });
      await mutate();
      setShowAdd(false);
      setForm({ ticker: "", alert_type: "custom", direction: "below", threshold: "" });
      toast.success("알림 추가 완료");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function deleteAlert(id: number) {
    await api.push.deleteAlert(id);
    await mutate();
    toast.success("알림 삭제");
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">알림 설정</h1>

      {/* 푸시 알림 활성화 */}
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
          손절가·목표가 도달 시 브라우저 알림을 받습니다. 모바일에서 홈화면 추가(PWA) 후 사용하면 앱 알림처럼 동작합니다.
        </p>
      </Card>

      {/* 가격 알림 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>가격 알림</CardTitle>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={13} /> 알림 추가
          </Button>
        </CardHeader>

        {showAdd && (
          <form onSubmit={addAlert} className="mb-4 p-3 rounded-lg border space-y-3" style={{ borderColor: "var(--border)" }}>
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>취소</Button>
              <Button type="submit" size="sm">추가</Button>
            </div>
          </form>
        )}

        {alertList.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">등록된 알림이 없습니다.</div>
        ) : (
          <div className="space-y-0">
            {alertList.map((a: any) => {
              const typeLabel = a.alert_type === "stop_loss" ? "손절가" : a.alert_type === "take_profit" ? "목표가" : "커스텀";
              const dirLabel = a.direction === "below" ? "이하" : "이상";
              return (
                <div key={a.id} className="flex items-center justify-between py-3 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <div className="text-sm font-medium">{a.ticker}</div>
                    <div className="text-xs text-muted-foreground">
                      {typeLabel} · {formatNumber(a.threshold)}원 {dirLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
