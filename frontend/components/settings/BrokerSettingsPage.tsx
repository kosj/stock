"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  BrokerConfigManager,
  type BrokerType,
  ApiKeyManager,
} from "@/lib/apiConfig";
import { CheckCircle, AlertCircle, Eye, EyeOff, Trash2, Lock, LockOpen } from "lucide-react";

const BROKER_INFO: Record<BrokerType, { name: string; description: string }> = {
  kis: {
    name: "한국투자증권",
    description: "App Key와 App Secret으로 실시간 시장 데이터 수집",
  },
  kb: { name: "KB증권", description: "준비 중..." },
  shinhan: { name: "신한증권", description: "준비 중..." },
  meritz: { name: "메리츠증권", description: "준비 중..." },
};

function validateMasterPassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push("최소 8자 이상이어야 합니다");
  if (!/[A-Z]/.test(password)) errors.push("대문자를 포함해야 합니다");
  if (!/[a-z]/.test(password)) errors.push("소문자를 포함해야 합니다");
  if (!/[0-9]/.test(password)) errors.push("숫자를 포함해야 합니다");
  return { valid: errors.length === 0, errors };
}

const ALL_BROKER_TYPES: BrokerType[] = ["kis", "kb", "shinhan", "meritz"];

export function BrokerSettingsPage() {
  const [configuredBrokers, setConfiguredBrokers] = useState<Record<BrokerType, boolean>>({
    kis: false, kb: false, shinhan: false, meritz: false,
  });
  const [showSecrets, setShowSecrets] = useState<Record<BrokerType, boolean>>({
    kis: false, kb: false, shinhan: false, meritz: false,
  });
  const [saving, setSaving] = useState<Record<BrokerType, boolean>>({
    kis: false, kb: false, shinhan: false, meritz: false,
  });
  const [editingBroker, setEditingBroker] = useState<BrokerType | null>(null);
  const [formData, setFormData] = useState({ appKey: "", appSecret: "", accountNumber: "" });

  // 단순 API 키
  const [anthropicKey, setAnthropicKey] = useState("");
  const [fredKey, setFredKey] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showFredKey, setShowFredKey] = useState(false);

  // 마스터 패스워드
  const [masterPasswordMode, setMasterPasswordMode] = useState<"setup" | "verify" | "none">("none");
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordConfirm, setMasterPasswordConfirm] = useState("");
  const [masterPasswordInput, setMasterPasswordInput] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setAnthropicKey(ApiKeyManager.getKey("anthropic"));
    setFredKey(ApiKeyManager.getKey("fred"));

    const isPasswordSet = BrokerConfigManager.isMasterPasswordSet();   // localStorage 해시 존재
    const isUnlocked    = BrokerConfigManager.isSessionUnlocked();     // sessionStorage 평문 존재

    if (!isPasswordSet) {
      // 처음 설정: 마스터 패스워드 생성
      setMasterPasswordMode("setup");
      setIsLocked(true);
    } else if (!isUnlocked) {
      // 브라우저 재시작 등으로 세션만 만료: 비밀번호 입력으로 잠금 해제
      setMasterPasswordMode("verify");
      setIsLocked(true);
    } else {
      // 이미 잠금 해제된 세션
      setMasterPasswordMode("none");
      setIsLocked(false);
    }

    setConfiguredBrokers({
      kis: BrokerConfigManager.hasBrokerConfig("kis"),
      kb: BrokerConfigManager.hasBrokerConfig("kb"),
      shinhan: BrokerConfigManager.hasBrokerConfig("shinhan"),
      meritz: BrokerConfigManager.hasBrokerConfig("meritz"),
    });
  }, []);

  const refreshConfigured = () => {
    setConfiguredBrokers({
      kis: BrokerConfigManager.hasBrokerConfig("kis"),
      kb: BrokerConfigManager.hasBrokerConfig("kb"),
      shinhan: BrokerConfigManager.hasBrokerConfig("shinhan"),
      meritz: BrokerConfigManager.hasBrokerConfig("meritz"),
    });
  };

  const handleSetMasterPassword = async () => {
    const validation = validateMasterPassword(masterPassword);
    if (!validation.valid) { setPasswordErrors(validation.errors); return; }
    if (masterPassword !== masterPasswordConfirm) { alert("마스터 패스워드가 일치하지 않습니다"); return; }
    try {
      await BrokerConfigManager.setMasterPassword(masterPassword);
      refreshConfigured();
      setIsLocked(false);
      setMasterPasswordMode("none");
      setMasterPassword("");
      setMasterPasswordConfirm("");
      setPasswordErrors([]);
      alert("마스터 패스워드가 설정되었습니다");
    } catch (error) {
      alert(`설정 실패: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleVerifyMasterPassword = async () => {
    const ok = await BrokerConfigManager.verifyMasterPassword(masterPasswordInput);
    if (ok) {
      refreshConfigured();
      setIsLocked(false);
      setMasterPasswordMode("none");
      setMasterPasswordInput("");
      alert("인증되었습니다");
    } else {
      alert("마스터 패스워드가 일치하지 않습니다");
    }
  };

  const handleLock = () => {
    BrokerConfigManager.clearMasterPassword();   // 세션만 잠금, 해시 유지
    setIsLocked(true);
    setMasterPasswordMode("verify");
  };

  const handleResetMasterPassword = () => {
    if (!confirm("마스터 패스워드를 초기화하면 저장된 모든 증권사 API 설정이 복호화 불가 상태가 됩니다.\n계속하시겠습니까?")) return;
    BrokerConfigManager.resetMasterPassword();
    ALL_BROKER_TYPES.forEach((t) => BrokerConfigManager.removeBrokerConfig(t));
    setIsLocked(true);
    setMasterPasswordMode("setup");
    setConfiguredBrokers({ kis: false, kb: false, shinhan: false, meritz: false });
  };

  const handleEditStart = async (type: BrokerType) => {
    if (isLocked) { alert("마스터 패스워드로 인증 후 사용할 수 있습니다"); return; }
    const config = await BrokerConfigManager.getBrokerConfig(type);
    setFormData(config
      ? { appKey: config.appKey, appSecret: config.appSecret, accountNumber: config.accountNumber ?? "" }
      : { appKey: "", appSecret: "", accountNumber: "" });
    setEditingBroker(type);
  };

  const handleSave = async (type: BrokerType) => {
    if (!formData.appKey || !formData.appSecret) {
      alert("App Key와 App Secret을 모두 입력해주세요");
      return;
    }
    setSaving((prev) => ({ ...prev, [type]: true }));
    try {
      await BrokerConfigManager.saveBrokerConfig(type, {
        appKey: formData.appKey,
        appSecret: formData.appSecret,
        accountNumber: formData.accountNumber || undefined,
      });
      refreshConfigured();
      setEditingBroker(null);
      alert("설정이 저장되었습니다");
    } catch (error) {
      alert(`저장 실패: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }));
    }
  };

  const handleDelete = (type: BrokerType) => {
    if (confirm(`${BROKER_INFO[type].name} 설정을 삭제하시겠습니까?`)) {
      BrokerConfigManager.removeBrokerConfig(type);
      setConfiguredBrokers((prev) => ({ ...prev, [type]: false }));
      setEditingBroker(null);
    }
  };

  if (!mounted) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
              <Lock className="w-6 h-6 text-red-400" />
              보안: 마스터 패스워드
            </h1>
            <p className="text-sm text-muted-foreground">
              API Key는 마스터 패스워드로 암호화되어 저장됩니다. AES-256-CBC + HMAC-SHA256 사용
            </p>
          </div>

          {masterPasswordMode === "setup" && (
            <Card className="border-blue-500/20 bg-blue-500/5 p-6">
              <h2 className="text-lg font-semibold mb-4">마스터 패스워드 설정</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">
                    마스터 패스워드
                  </label>
                  <input
                    type="password"
                    value={masterPassword}
                    onChange={(e) => {
                      setMasterPassword(e.target.value);
                      setPasswordErrors(validateMasterPassword(e.target.value).errors);
                    }}
                    placeholder="대문자, 소문자, 숫자를 포함한 8자 이상"
                    className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                  />
                  {passwordErrors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {passwordErrors.map((error) => (
                        <p key={error} className="text-xs text-red-400">• {error}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">
                    패스워드 확인
                  </label>
                  <input
                    type="password"
                    value={masterPasswordConfirm}
                    onChange={(e) => setMasterPasswordConfirm(e.target.value)}
                    placeholder="패스워드 다시 입력"
                    className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSetMasterPassword()}
                  />
                </div>
                <Button onClick={handleSetMasterPassword} className="w-full">
                  마스터 패스워드 설정
                </Button>
              </div>
            </Card>
          )}

          {masterPasswordMode === "verify" && (
            <Card className="border-yellow-500/20 bg-yellow-500/5 p-6">
              <h2 className="text-lg font-semibold mb-1">마스터 패스워드 입력</h2>
              <p className="text-xs text-muted-foreground mb-4">
                저장된 API 키가 있습니다. 마스터 패스워드를 입력하면 바로 사용할 수 있습니다.
              </p>
              <div className="space-y-4">
                <input
                  type="password"
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder="마스터 패스워드 입력"
                  className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyMasterPassword()}
                  autoFocus
                />
                <Button onClick={handleVerifyMasterPassword} className="w-full">
                  잠금 해제
                </Button>
                <button
                  onClick={handleResetMasterPassword}
                  className="w-full text-xs text-muted-foreground hover:text-red-400 transition-colors py-1"
                >
                  패스워드를 잊으셨나요? 초기화 (API 키 전체 삭제)
                </button>
              </div>
            </Card>
          )}

          <Card className="border-green-500/20 bg-green-500/5 p-4">
            <div className="space-y-2 text-sm">
              <div className="font-semibold text-green-400 flex items-center gap-2">
                <CheckCircle size={16} />
                보안 사양
              </div>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li><strong>암호화:</strong> AES-256-CBC (NIST 승인, 산업 표준)</li>
                <li><strong>키 유도:</strong> PBKDF2-SHA256 (100,000 iterations)</li>
                <li><strong>Salt:</strong> 128비트 난수 (매번 새로 생성)</li>
                <li><strong>IV:</strong> 128비트 난수 (매번 새로 생성)</li>
                <li><strong>인증:</strong> HMAC-SHA256 (무결성 및 위조 방지)</li>
                <li><strong>패스워드:</strong> 대소문자, 숫자 필수, 최소 8자</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <LockOpen className="w-6 h-6 text-green-400" />
            증권사 API 설정
          </h1>
          <p className="text-sm text-muted-foreground">
            실시간 시장 데이터를 수집하기 위해 증권사 API를 설정하세요.
          </p>
        </div>
        <Button onClick={handleLock} variant="ghost" className="text-yellow-400 hover:text-yellow-300">
          <Lock size={16} />
          잠금
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {ALL_BROKER_TYPES.map((type) => {
          const info = BROKER_INFO[type];
          const isConfigured = configuredBrokers[type];
          const isEditing = editingBroker === type;
          const isSaving = saving[type];

          return (
            <Card key={type} className={isConfigured ? "border-blue-500/30 bg-blue-500/5" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-lg">{info.name}</CardTitle>
                        {isConfigured && <CheckCircle className="w-5 h-5 text-green-400" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>
                  </div>
                  {type !== "kis" && (
                    <div className="px-3 py-1 rounded text-xs bg-muted text-muted-foreground">준비 중</div>
                  )}
                </div>
              </CardHeader>

              {isEditing ? (
                <div className="px-6 pb-6 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">App Key</label>
                    <input
                      type="text"
                      value={formData.appKey}
                      onChange={(e) => setFormData({ ...formData, appKey: e.target.value })}
                      placeholder="App Key 입력"
                      className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                      disabled={isSaving}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">App Secret</label>
                    <div className="flex gap-2">
                      <input
                        type={showSecrets[type] ? "text" : "password"}
                        value={formData.appSecret}
                        onChange={(e) => setFormData({ ...formData, appSecret: e.target.value })}
                        placeholder="App Secret 입력"
                        className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm"
                        disabled={isSaving}
                      />
                      <button
                        onClick={() => setShowSecrets({ ...showSecrets, [type]: !showSecrets[type] })}
                        className="px-3 py-2 text-muted-foreground hover:text-foreground"
                      >
                        {showSecrets[type] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                      계좌번호 <span className="text-muted-foreground/60 font-normal">(보유종목 조회에 필요)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      placeholder="예: 12345678-01 또는 1234567801"
                      className="w-full px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
                      disabled={isSaving}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      계좌번호 앞 8자리 + 뒤 2자리 (종합/위탁: 01)
                    </p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button onClick={() => handleSave(type)} disabled={isSaving} className="flex-1">
                      {isSaving ? "저장 중..." : "저장"}
                    </Button>
                    <Button onClick={() => setEditingBroker(null)} variant="ghost" disabled={isSaving}>
                      취소
                    </Button>
                  </div>
                  {isConfigured && (
                    <p className="text-xs text-yellow-400 flex items-start gap-1.5">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span>기존 설정을 덮어씁니다</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-6 pb-6 flex gap-2">
                  {type === "kis" && (
                    <>
                      <Button
                        onClick={() => handleEditStart(type)}
                        variant={isConfigured ? "default" : "ghost"}
                        className="flex-1"
                      >
                        {isConfigured ? "수정" : "설정"}
                      </Button>
                      {isConfigured && (
                        <Button
                          onClick={() => handleDelete(type)}
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 size={16} />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Anthropic API 키 */}
      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Anthropic API 키
                {!!anthropicKey && <CheckCircle className="w-5 h-5 text-green-400" />}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">AI 종목 분석에 사용 (Claude API)</p>
            </div>
          </div>
        </CardHeader>
        <div className="px-6 pb-6 space-y-3">
          <div className="flex gap-2">
            <input
              type={showAnthropicKey ? "text" : "password"}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
            />
            <button
              onClick={() => setShowAnthropicKey(!showAnthropicKey)}
              className="px-3 py-2 text-muted-foreground hover:text-foreground"
            >
              {showAnthropicKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => { ApiKeyManager.saveKey("anthropic", anthropicKey); alert("Anthropic API 키가 저장되었습니다"); }}
              className="flex-1"
              disabled={!anthropicKey}
            >
              저장
            </Button>
            {!!anthropicKey && (
              <Button
                variant="ghost"
                className="text-red-400 hover:text-red-300"
                onClick={() => { ApiKeyManager.removeKey("anthropic"); setAnthropicKey(""); }}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            키가 없으면 규칙 기반 분석만 제공됩니다.{" "}
            <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
              Anthropic Console
            </a>에서 발급
          </p>
        </div>
      </Card>

      {/* FRED API 키 */}
      <Card className="border-orange-500/20 bg-orange-500/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                FRED API 키
                {!!fredKey && <CheckCircle className="w-5 h-5 text-green-400" />}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">거시경제 지표 조회 (금리·인플레이션)</p>
            </div>
          </div>
        </CardHeader>
        <div className="px-6 pb-6 space-y-3">
          <div className="flex gap-2">
            <input
              type={showFredKey ? "text" : "password"}
              value={fredKey}
              onChange={(e) => setFredKey(e.target.value)}
              placeholder="FRED API 키 입력"
              className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm font-mono"
            />
            <button
              onClick={() => setShowFredKey(!showFredKey)}
              className="px-3 py-2 text-muted-foreground hover:text-foreground"
            >
              {showFredKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => { ApiKeyManager.saveKey("fred", fredKey); alert("FRED API 키가 저장되었습니다"); }}
              className="flex-1"
              disabled={!fredKey}
            >
              저장
            </Button>
            {!!fredKey && (
              <Button
                variant="ghost"
                className="text-red-400 hover:text-red-300"
                onClick={() => { ApiKeyManager.removeKey("fred"); setFredKey(""); }}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            키가 없으면 거시경제 지수 데이터 없이 환율/지수만 제공됩니다.{" "}
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">
              FRED API 키 발급
            </a>
          </p>
        </div>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <div className="font-semibold">한국투자증권 API 설정 방법</div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>
                <a href="https://www.kisapi.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  KIS API 개발자 센터
                </a>에 가입
              </li>
              <li>앱 등록 후 App Key와 App Secret 발급받기</li>
              <li>위의 입력란에 App Key와 App Secret 입력</li>
              <li>저장하면 실시간 시장 데이터가 수집됩니다</li>
            </ol>
          </div>
        </div>
      </Card>

      <Card className="border-green-500/20 bg-green-500/5 p-4">
        <div className="space-y-2 text-sm">
          <div className="font-semibold text-green-400 flex items-center gap-2">
            <CheckCircle size={16} />
            보안 기능
          </div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li><strong>마스터 패스워드:</strong> 모든 API Key를 마스터 패스워드로 암호화</li>
            <li><strong>AES-256-CBC:</strong> NIST 승인 산업 표준 블록 암호화</li>
            <li><strong>PBKDF2-SHA256:</strong> 100,000 iterations로 강력한 키 유도</li>
            <li><strong>Random Salt & IV:</strong> 각 저장마다 새로운 128비트 난수 생성</li>
            <li><strong>HMAC-SHA256:</strong> 데이터 무결성 및 위조 방지 검증</li>
            <li><strong>영구 저장:</strong> 패스워드와 해시 모두 localStorage에 보관 — 브라우저 재시작 후 자동 복원</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
