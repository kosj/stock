"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { BrokerConfigManager } from "@/lib/apiConfig";
import { Button } from "@/components/ui/Button";
import { toast } from "sonner";
import { X, Search, Zap, Loader2 } from "lucide-react";

interface Props {
  portfolioId: number;
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
}

interface SearchResult {
  ticker: string;
  name: string;
  market?: string;
}

export function PositionModal({ portfolioId, initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;

  const [form, setForm] = useState({
    ticker:      initial?.ticker ?? "",
    name:        initial?.name ?? "",
    quantity:    initial?.quantity ?? "",
    avg_price:   initial?.avg_price ?? "",
    stop_loss:   initial?.stop_loss ?? "",
    take_profit: initial?.take_profit ?? "",
    strategy:    initial?.strategy ?? "",
    notes:       initial?.notes ?? "",
  });

  // 종목 검색 상태
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isValidated, setIsValidated] = useState(isEdit); // 수정 모드는 이미 유효
  const [brokerCreds, setBrokerCreds] = useState<{ type: string; appKey: string; appSecret: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    BrokerConfigManager.getDefaultBrokerConfig().then((config) => {
      if (!config) return;
      setBrokerCreds({ type: config.type, appKey: config.credentials.appKey, appSecret: config.credentials.appSecret });
    });
  }, []);

  // AI 채우기 상태
  const [aiLoading, setAiLoading] = useState(false);

  const [loading, setLoading] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // 종목명 디바운스 검색
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm((f) => ({ ...f, name: val, ticker: isEdit ? f.ticker : "" }));
    setIsValidated(isEdit);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim() || isEdit) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await api.market.search(val, brokerCreds) as SearchResult[];
        setSearchResults(data.slice(0, 8));
        setShowDropdown(data.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, [isEdit]);

  // 검색 결과 선택
  function selectStock(stock: SearchResult) {
    setForm((f) => ({ ...f, ticker: stock.ticker, name: stock.name }));
    setIsValidated(true);
    setShowDropdown(false);
    setSearchResults([]);
  }

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // AI 자동 채우기 (손절가/목표가/전략)
  async function fillFromAI() {
    const ticker = form.ticker.trim();
    if (!ticker) {
      toast.error("종목코드를 먼저 입력하거나 종목을 검색하여 선택해주세요.");
      return;
    }
    setAiLoading(true);
    try {
      const analysis = await api.analysis.get(ticker) as any;

      const strategyMap: Record<string, string> = {
        "Strong Buy": "적극 매수 — 분할 매수 후 장기 보유",
        "Buy":        "매수 — 지지선 확인 후 비중 확대",
        "Hold":       "보유 유지 — 추가 매수 보류, 모니터링",
        "Sell":       "매도 검토 — 리스크 관리 우선",
        "Strong Sell":"적극 매도 — 손절 후 현금 확보",
      };
      const rec = analysis.recommendation ?? "Hold";
      const strategy = `${strategyMap[rec] ?? rec} (AI 점수: ${(analysis.score ?? 0).toFixed(0)}/100)`;

      setForm((f) => ({
        ...f,
        stop_loss:   analysis.stop_price  ? String(Math.round(analysis.stop_price))  : f.stop_loss,
        take_profit: analysis.target_price ? String(Math.round(analysis.target_price)) : f.take_profit,
        strategy,
      }));
      toast.success(`AI 분석 완료 — ${rec} 의견 적용`);
    } catch (err: any) {
      toast.error("AI 분석 실패: " + (err.message ?? "오류"));
    } finally {
      setAiLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // 신규 추가 시 유효성 검증
    if (!isEdit && !isValidated) {
      toast.error("검색 결과에서 종목을 선택해주세요. 잘못된 종목명은 추가할 수 없습니다.");
      return;
    }
    if (!form.ticker.trim()) {
      toast.error("종목코드를 확인해주세요.");
      return;
    }

    setLoading(true);
    try {
      const body = {
        ticker:      form.ticker.toUpperCase(),
        name:        form.name,
        quantity:    Number(form.quantity),
        avg_price:   Number(form.avg_price),
        stop_loss:   form.stop_loss   ? Number(form.stop_loss)   : null,
        take_profit: form.take_profit ? Number(form.take_profit) : null,
        strategy:    form.strategy    || null,
        notes:       form.notes       || null,
      };
      if (isEdit) {
        await api.portfolio.updatePosition(initial.position_id, body);
        toast.success("종목 수정 완료");
      } else {
        await api.portfolio.addPosition(portfolioId, body);
        toast.success("종목 추가 완료");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? "오류 발생");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-md rounded-xl border p-6"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={18} />
        </button>
        <h2 className="text-base font-semibold mb-4">{isEdit ? "종목 수정" : "종목 추가"}</h2>

        <form onSubmit={submit} className="space-y-3">
          {/* 종목명 검색 */}
          <div ref={dropdownRef} className="relative">
            <Field label="종목명 검색" required>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={form.name}
                  onChange={handleNameChange}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  placeholder={isEdit ? form.name : "삼성전자, AAPL…"}
                  className={`${inputCls} pl-8 pr-8`}
                  required
                  disabled={isEdit}
                />
                {searchLoading && (
                  <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                )}
                {isValidated && !isEdit && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs">✓</span>
                )}
              </div>
            </Field>

            {/* 검색 드롭다운 */}
            {showDropdown && searchResults.length > 0 && (
              <div
                className="absolute z-10 w-full mt-1 rounded-lg border shadow-lg overflow-hidden"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                {searchResults.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => selectStock(r)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 transition-colors text-left border-b last:border-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div>
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">{r.ticker}</span>
                    </div>
                    {r.market && <span className="text-xs text-muted-foreground">{r.market}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 종목코드 (자동 채워짐) */}
          <Field label="종목코드" required>
            <input
              value={form.ticker}
              onChange={(e) => {
                setForm((f) => ({ ...f, ticker: e.target.value }));
                if (!isEdit) setIsValidated(false);
              }}
              placeholder="자동 입력 (검색 후 선택)"
              className={`${inputCls} font-mono ${!isValidated && !isEdit ? "border-yellow-500/50" : ""}`}
              required
              disabled={isEdit}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="수량" required>
              <input type="number" value={form.quantity} onChange={set("quantity")}
                placeholder="100" className={inputCls} required min="1" />
            </Field>
            <Field label="평균단가 (원)" required>
              <input type="number" value={form.avg_price} onChange={set("avg_price")}
                placeholder="72000" className={inputCls} required min="1" />
            </Field>
          </div>

          {/* 손절가/목표가 + AI 버튼 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">손절가 / 목표가</span>
              <button
                type="button"
                onClick={fillFromAI}
                disabled={aiLoading || !form.ticker.trim()}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {aiLoading
                  ? <><Loader2 size={11} className="animate-spin" /> 분석 중…</>
                  : <><Zap size={11} /> AI 자동 채우기</>
                }
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={form.stop_loss} onChange={set("stop_loss")}
                placeholder="손절가 (선택)" className={inputCls} min="1" />
              <input type="number" value={form.take_profit} onChange={set("take_profit")}
                placeholder="목표가 (선택)" className={inputCls} min="1" />
            </div>
          </div>

          <Field label="대응 전략">
            <input value={form.strategy} onChange={set("strategy")}
              placeholder="AI 채우기 또는 직접 입력 (단기 트레이딩, 장기 보유…)" className={inputCls} />
          </Field>

          <Field label="메모">
            <textarea value={form.notes} onChange={set("notes")}
              placeholder="매수 근거 등" className={`${inputCls} resize-none`} rows={2} />
          </Field>

          {/* 유효성 안내 */}
          {!isEdit && !isValidated && form.name && (
            <p className="text-xs text-yellow-400">
              ⚠ 검색 결과 목록에서 종목을 선택해야 추가할 수 있습니다.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={loading || aiLoading}>
              {loading ? "저장 중..." : (isEdit ? "수정" : "추가")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-muted text-foreground text-sm px-3 py-2 rounded-md border focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50";
