"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ApiKeyManager } from "@/lib/apiConfig";
import { CheckCircle, AlertCircle, Eye, EyeOff, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ── 브로커 메타 ────────────────────────────────────────────────────────────────

type BrokerType = "kis" | "miraeasset" | "kb" | "shinhan" | "meritz";

interface BrokerMeta {
  name:              string;
  description:       string;
  available:         boolean;
  accountPlaceholder?: string;
  accountHelp?:        string;
}

const BROKER_INFO: Record<BrokerType, BrokerMeta> = {
  kis: {
    name:               "한국투자증권",
    description:        "App Key · App Secret · 계좌번호로 보유종목 조회",
    available:          true,
    accountPlaceholder: "예: 12345678-01",
    accountHelp:        "앞 8자리 + 뒤 2자리 (종합/위탁계좌: 01)",
  },
  miraeasset: { name: "미래에셋증권", description: "준비 중",       available: false },
  kb:         { name: "KB증권",       description: "준비 중",       available: false },
  shinhan:    { name: "신한증권",     description: "준비 중",       available: false },
  meritz:     { name: "메리츠증권",   description: "준비 중",       available: false },
};
const BROKER_TYPES: BrokerType[] = ["kis", "miraeasset", "kb", "shinhan", "meritz"];

// ── API 헬퍼 ──────────────────────────────────────────────────────────────────

async function fetchConfigured(): Promise<string[]> {
  const res = await fetch("/api/settings/broker");
  // 실패를 빈 목록으로 위장하면 '등록된 계정 없음'으로 오해된다
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return data.configured ?? [];
}

// ── 브로커 카드 ───────────────────────────────────────────────────────────────

function BrokerCard({
  type,
  isConfigured,
  onSaved,
  onDeleted,
}: {
  type:        BrokerType;
  isConfigured: boolean;
  onSaved:     () => void;
  onDeleted:   () => void;
}) {
  const info = BROKER_INFO[type];
  const [editing, setEditing]         = useState(false);
  const [saving,  setSaving]          = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [showSecret, setShowSecret]   = useState(false);
  const [form, setForm] = useState({ appKey: "", appSecret: "", accountNumber: "", isDemo: false });

  async function handleSave() {
    // 모바일 키보드 자동완성·공백 제거
    const trimmed = {
      appKey:        form.appKey.trim(),
      appSecret:     form.appSecret.trim(),
      accountNumber: form.accountNumber.trim(),
      isDemo: form.isDemo,
    };
    if (!trimmed.appKey || !trimmed.appSecret) {
      toast.error("App Key와 App Secret을 모두 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/broker", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, ...trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      toast.success("설정이 저장되었습니다.");
      setEditing(false);
      setForm({ appKey: "", appSecret: "", accountNumber: "", isDemo: false });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`${info.name} 설정을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/settings/broker/${type}`, { method: "DELETE" });
      if (!response.ok) throw new Error("증권사 설정 삭제 실패");
      toast.success("삭제 완료");
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제 실패");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className={isConfigured ? "border-blue-500/30 bg-blue-500/5" : ""}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{info.name}</CardTitle>
          {isConfigured && <CheckCircle className="w-4 h-4 text-green-400" />}
          {!info.available && (
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">준비 중</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{info.description}</p>
      </CardHeader>

      {info.available && (
        <div className="px-5 pb-5">
          {editing ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDemo} disabled={saving}
                  onChange={(event) => setForm((f) => ({ ...f, isDemo: event.target.checked }))} />
                KIS 모의투자 API 환경 (모의투자용 키로 저장)
              </label>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">App Key</label>
                <input
                  value={form.appKey}
                  onChange={(e) => setForm((f) => ({ ...f, appKey: e.target.value }))}
                  placeholder="App Key 입력"
                  className="w-full px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
                  disabled={saving}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">App Secret</label>
                <div className="flex gap-2">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={form.appSecret}
                    onChange={(e) => setForm((f) => ({ ...f, appSecret: e.target.value }))}
                    placeholder="App Secret 입력"
                    className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
                    disabled={saving}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => setShowSecret((v) => !v)}
                    className="px-3 text-muted-foreground hover:text-foreground"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  계좌번호 <span className="text-muted-foreground/60">(보유종목 조회에 필요)</span>
                </label>
                <input
                  value={form.accountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  placeholder={info.accountPlaceholder ?? "계좌번호 입력"}
                  className="w-full px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
                  disabled={saving}
                />
                {info.accountHelp && (
                  <p className="text-xs text-muted-foreground mt-1">{info.accountHelp}</p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? <><Loader2 size={13} className="animate-spin" /> 저장 중…</> : "저장"}
                </Button>
                <Button variant="ghost" onClick={() => { setEditing(false); setForm({ appKey: "", appSecret: "", accountNumber: "", isDemo: false }); }} disabled={saving}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant={isConfigured ? "default" : "ghost"} className="flex-1" onClick={() => setEditing(true)}>
                {isConfigured ? "수정" : "설정"}
              </Button>
              {isConfigured && (
                <Button variant="ghost" className="text-red-400 hover:text-red-300" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── 단순 API 키 카드 (Anthropic, FRED) ────────────────────────────────────────

function SimpleApiKeyCard({
  name, title, description, placeholder, linkHref, linkLabel, color,
}: {
  name:        "anthropic" | "fred";
  title:       string;
  description: string;
  placeholder: string;
  linkHref:    string;
  linkLabel:   string;
  color:       string;
}) {
  const [value, setValue]   = useState("");
  const [show,  setShow]    = useState(false);
  return (
    <Card className={`border-${color}-500/20 bg-${color}-500/5`}>
      <CardHeader>
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            {title}
            {!!value && <CheckCircle className="w-4 h-4 text-green-400" />}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </CardHeader>
      <div className="px-5 pb-5 space-y-3">
        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
          />
          <button onClick={() => setShow((v) => !v)} className="px-3 text-muted-foreground hover:text-foreground">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!value}
            onClick={() => { ApiKeyManager.saveKey(name, value); toast.success(`${title} 현재 탭에 적용되었습니다.`); }}
          >
            현재 탭에 적용
          </Button>
          {!!value && (
            <Button variant="ghost" className="text-red-400 hover:text-red-300"
              onClick={() => { ApiKeyManager.removeKey(name); setValue(""); }}>
              <Trash2 size={14} />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          키는 현재 탭 메모리에만 보관하며 새로고침·로그아웃 시 삭제됩니다. 기존 브라우저 저장 키는 삭제됩니다.
        </p>
        <p className="text-xs text-muted-foreground">
          <a href={linkHref} target="_blank" rel="noopener noreferrer" className={`text-${color}-400 hover:underline`}>
            {linkLabel}
          </a>에서 발급
        </p>
      </div>
    </Card>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export function BrokerSettingsPage() {
  const { data: configured = [], mutate } = useSWR<string[]>(
    "broker-settings-configured",
    fetchConfigured,
    { revalidateOnFocus: false },
  );

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold mb-1">API 설정</h1>
        <p className="text-sm text-muted-foreground">
          증권사 API 키는 서버에서 AES-256-GCM으로 암호화한 뒤 데이터베이스에 저장됩니다.
        </p>
      </div>

      {/* 암호화 키 미설정 경고 */}
      <Card className="border-yellow-500/30 bg-yellow-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1 min-w-0">
            <div className="font-semibold text-yellow-400">증권사 API 키 등록 안내</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>키는 서버에 암호화하여 보관하며 화면에서 다시 조회하지 않습니다. 키를 변경하려면 새 키를 입력해주세요.</p>
              <p>기존 브라우저에 저장했던 키와 마스터 비밀번호는 삭제됩니다. 필요한 증권사 키는 이 화면에서 다시 등록해주세요.</p>
            </div>
          </div>
        </div>
      </Card>

      {/* 증권사 카드 */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">증권사 API</h2>
        {BROKER_TYPES.map((type) => (
          <BrokerCard
            key={type}
            type={type}
            isConfigured={configured.includes(type)}
            onSaved={() => mutate()}
            onDeleted={() => mutate()}
          />
        ))}
      </section>

      {/* KIS 설정 안내 */}
      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <div className="font-semibold">한국투자증권 API 설정 방법</div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>
                <a href="https://apiportal.koreainvestment.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  KIS 개발자 포털
                </a>에서 앱 등록 후 App Key · App Secret 발급
              </li>
              <li>포털 → 앱 관리 → IP 설정에서 <strong>0.0.0.0 (전체 허용)</strong> 추가 (Vercel 고정 IP 없음)</li>
              <li>위 카드에서 설정 버튼 클릭 → App Key / App Secret / 계좌번호 입력 후 저장</li>
              <li>포트폴리오 페이지 → 보유종목 가져오기 버튼 사용</li>
            </ol>
          </div>
        </div>
      </Card>

      {/* 단순 API 키 */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">AI · 데이터 API</h2>

        <SimpleApiKeyCard
          name="anthropic"
          title="Anthropic API 키"
          description="AI 종목 분석에 사용 (Claude API)"
          placeholder="sk-ant-..."
          linkHref="https://console.anthropic.com/"
          linkLabel="Anthropic Console"
          color="purple"
        />

        <SimpleApiKeyCard
          name="fred"
          title="FRED API 키"
          description="거시경제 지표 조회 (금리·인플레이션)"
          placeholder="FRED API 키 입력"
          linkHref="https://fred.stlouisfed.org/docs/api/api_key.html"
          linkLabel="FRED API 키 발급"
          color="orange"
        />
      </section>
    </div>
  );
}
