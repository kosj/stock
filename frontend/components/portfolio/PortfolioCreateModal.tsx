"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { toast } from "sonner";
import { X, Plus, Trash2 } from "lucide-react";

interface PositionRow {
  ticker: string;
  name: string;
  quantity: string;
  avg_price: string;
  stop_loss: string;
  take_profit: string;
}

const emptyRow = (): PositionRow => ({
  ticker: "", name: "", quantity: "", avg_price: "",
  stop_loss: "", take_profit: "",
});

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function PortfolioCreateModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);

  function addRow() {
    setRows((r) => [...r, emptyRow()]);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof PositionRow, value: string) {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("포트폴리오 이름을 입력해주세요.");
      return;
    }

    // 입력된 종목 행 유효성 검사
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.ticker.trim() || !r.name.trim() || !r.quantity || !r.avg_price) {
        toast.error(`${i + 1}번째 종목: 종목코드, 종목명, 수량, 평균단가는 필수입니다.`);
        return;
      }
    }

    setLoading(true);
    try {
      const portfolio = await api.portfolio.create({ name: name.trim(), description: description.trim() || undefined }) as any;

      // 종목 순차 추가
      for (const r of rows) {
        await api.portfolio.addPosition(portfolio.id, {
          ticker: r.ticker.toUpperCase(),
          name: r.name,
          quantity: Number(r.quantity),
          avg_price: Number(r.avg_price),
          stop_loss: r.stop_loss ? Number(r.stop_loss) : null,
          take_profit: r.take_profit ? Number(r.take_profit) : null,
        });
      }

      toast.success(`포트폴리오 "${portfolio.name}" 생성 완료${rows.length ? ` (종목 ${rows.length}개 추가)` : ""}`);
      onCreated();
    } catch (err: any) {
      toast.error(err.message ?? "포트폴리오 생성 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="relative w-full max-w-3xl rounded-xl border max-h-[90vh] flex flex-col"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-semibold">새 포트폴리오 생성</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <form id="portfolio-create-form" onSubmit={submit}>
            {/* 기본 정보 */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  포트폴리오 이름 <span className="text-red-400">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="내 포트폴리오"
                  className={inputCls}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">설명 (선택)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="장기 성장주 포트폴리오"
                  className={inputCls}
                />
              </div>
            </div>

            {/* 보유 종목 직접 입력 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  보유 종목 입력
                  <span className="text-xs text-muted-foreground ml-1.5">(선택 — 나중에 추가 가능)</span>
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={addRow}>
                  <Plus size={13} /> 종목 추가
                </Button>
              </div>

              {rows.length > 0 && (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  {/* 테이블 헤더 */}
                  <div className="grid text-xs text-muted-foreground font-normal px-3 py-2 border-b bg-muted/30"
                       style={{ gridTemplateColumns: "1fr 1.2fr 0.7fr 1fr 0.9fr 0.9fr 32px", borderColor: "var(--border)" }}>
                    <span>종목코드 <span className="text-red-400">*</span></span>
                    <span>종목명 <span className="text-red-400">*</span></span>
                    <span>수량 <span className="text-red-400">*</span></span>
                    <span>평균단가(원) <span className="text-red-400">*</span></span>
                    <span>손절가(원)</span>
                    <span>목표가(원)</span>
                    <span />
                  </div>

                  {rows.map((row, i) => (
                    <div
                      key={i}
                      className="grid gap-1.5 px-2 py-2 border-b last:border-0"
                      style={{ gridTemplateColumns: "1fr 1.2fr 0.7fr 1fr 0.9fr 0.9fr 32px", borderColor: "var(--border)" }}
                    >
                      <input
                        value={row.ticker}
                        onChange={(e) => updateRow(i, "ticker", e.target.value)}
                        placeholder="005930"
                        className={rowInputCls}
                      />
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(i, "name", e.target.value)}
                        placeholder="삼성전자"
                        className={rowInputCls}
                      />
                      <input
                        type="number"
                        value={row.quantity}
                        onChange={(e) => updateRow(i, "quantity", e.target.value)}
                        placeholder="100"
                        className={rowInputCls}
                        min="1"
                      />
                      <input
                        type="number"
                        value={row.avg_price}
                        onChange={(e) => updateRow(i, "avg_price", e.target.value)}
                        placeholder="72000"
                        className={rowInputCls}
                        min="1"
                      />
                      <input
                        type="number"
                        value={row.stop_loss}
                        onChange={(e) => updateRow(i, "stop_loss", e.target.value)}
                        placeholder="-"
                        className={rowInputCls}
                        min="1"
                      />
                      <input
                        type="number"
                        value={row.take_profit}
                        onChange={(e) => updateRow(i, "take_profit", e.target.value)}
                        placeholder="-"
                        className={rowInputCls}
                        min="1"
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="flex items-center justify-center text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {rows.length === 0 && (
                <div
                  className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground cursor-pointer hover:border-blue-500/40 transition-colors"
                  style={{ borderColor: "var(--border)" }}
                  onClick={addRow}
                >
                  <Plus size={16} className="mx-auto mb-1 opacity-50" />
                  종목 추가 버튼으로 보유 종목을 입력하세요
                </div>
              )}
            </div>
          </form>
        </div>

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2 p-4 border-t shrink-0" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>취소</Button>
          <Button form="portfolio-create-form" type="submit" disabled={loading}>
            {loading ? "생성 중..." : `포트폴리오 생성${rows.length ? ` (종목 ${rows.length}개)` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-muted text-foreground text-sm px-3 py-2 rounded-md border focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50";

const rowInputCls =
  "w-full bg-muted text-foreground text-xs px-2 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/40 border";
