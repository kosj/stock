"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrokerConfigManager, type BrokerType, isBrokerConfigured, getConfiguredBrokersList } from "@/lib/apiConfig";
import { CheckCircle, AlertCircle, Eye, EyeOff, Trash2, Lock, LockOpen } from "lucide-react";

const BROKER_INFO: Record<BrokerType, { name: string; description: string }> = {
  kis: {
    name: "한국투자증권",
    description: "App Key와 App Secret으로 실시간 시장 데이터 수집"
  },
  kb: {
    name: "KB증권",
    description: "준비 중..."
  },
  shinhan: {
    name: "신한증권",
    description: "준비 중..."
  },
  meritz: {
    name: "메리츠증권",
    description: "준비 중..."
  }
};

// 패스워드 강도 검증
function validateMasterPassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("최소 8자 이상이어야 합니다");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("대문자를 포함해야 합니다");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("소문자를 포함해야 합니다");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("숫자를 포함해야 합니다");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function BrokerSettingsPage() {
  const [brokers, setBrokers] = useState<BrokerType[]>(['kis', 'kb', 'shinhan', 'meritz']);
  const [configs, setConfigs] = useState<Record<BrokerType, { appKey: string; appSecret: string } | null>>({
    kis: null,
    kb: null,
    shinhan: null,
    meritz: null
  });
  const [showSecrets, setShowSecrets] = useState<Record<BrokerType, boolean>>({
    kis: false,
    kb: false,
    shinhan: false,
    meritz: false
  });
  const [loading, setLoading] = useState<Record<BrokerType, boolean>>({
    kis: false,
    kb: false,
    shinhan: false,
    meritz: false
  });
  const [editingBroker, setEditingBroker] = useState<BrokerType | null>(null);
  const [formData, setFormData] = useState({ appKey: '', appSecret: '' });

  // 마스터 패스워드 관련
  const [masterPasswordMode, setMasterPasswordMode] = useState<'setup' | 'verify' | 'none'>('none');
  const [masterPassword, setMasterPassword] = useState('');
  const [masterPasswordConfirm, setMasterPasswordConfirm] = useState('');
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 초기 로드 - 클라이언트에서만 실행
  useEffect(() => {
    setMounted(true);

    const isMasterSet = BrokerConfigManager.isMasterPasswordSet();
    setIsLocked(!isMasterSet);
    if (!isMasterSet) {
      setMasterPasswordMode('setup');
    } else {
      setMasterPasswordMode('verify');
    }

    if (!isMasterSet) {
      setConfigs({
        kis: null,
        kb: null,
        shinhan: null,
        meritz: null
      });
    } else {
      const allConfigs = BrokerConfigManager.getAllBrokerConfigs();
      setConfigs(allConfigs);
    }
  }, []);

  // 마스터 패스워드 설정
  const handleSetMasterPassword = () => {
    const validation = validateMasterPassword(masterPassword);
    if (!validation.valid) {
      setPasswordErrors(validation.errors);
      return;
    }

    if (masterPassword !== masterPasswordConfirm) {
      alert('마스터 패스워드가 일치하지 않습니다');
      return;
    }

    try {
      BrokerConfigManager.setMasterPassword(masterPassword);
      const allConfigs = BrokerConfigManager.getAllBrokerConfigs();
      setConfigs(allConfigs);
      setIsLocked(false);
      setMasterPasswordMode('none');
      setMasterPassword('');
      setMasterPasswordConfirm('');
      setPasswordErrors([]);
      alert('마스터 패스워드가 설정되었습니다');
    } catch (error) {
      alert(`설정 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // 마스터 패스워드 검증
  const handleVerifyMasterPassword = () => {
    if (BrokerConfigManager.verifyMasterPassword(masterPasswordInput)) {
      const allConfigs = BrokerConfigManager.getAllBrokerConfigs();
      setConfigs(allConfigs);
      setIsLocked(false);
      setMasterPasswordMode('none');
      setMasterPasswordInput('');
      alert('인증되었습니다');
    } else {
      alert('마스터 패스워드가 일치하지 않습니다');
    }
  };

  // 마스터 패스워드 잠금
  const handleLock = () => {
    BrokerConfigManager.clearMasterPassword();
    setIsLocked(true);
    setMasterPasswordMode('verify');
  };

  // 편집 시작
  const handleEditStart = (type: BrokerType) => {
    if (isLocked) {
      alert('마스터 패스워드로 인증 후 사용할 수 있습니다');
      return;
    }
    const config = BrokerConfigManager.getBrokerConfig(type);
    if (config) {
      setFormData({ appKey: config.appKey, appSecret: config.appSecret });
    } else {
      setFormData({ appKey: '', appSecret: '' });
    }
    setEditingBroker(type);
  };

  // 저장
  const handleSave = async (type: BrokerType) => {
    if (!formData.appKey || !formData.appSecret) {
      alert('App Key와 App Secret을 모두 입력해주세요');
      return;
    }

    setLoading({ ...loading, [type]: true });
    try {
      const currentPassword = sessionStorage.getItem('__master_password__') || '';
      BrokerConfigManager.saveBrokerConfig(type, formData, currentPassword);
      const updatedConfigs = BrokerConfigManager.getAllBrokerConfigs();
      setConfigs(updatedConfigs);
      setEditingBroker(null);
      alert('설정이 저장되었습니다');
    } catch (error) {
      alert(`저장 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading({ ...loading, [type]: false });
    }
  };

  // 삭제
  const handleDelete = (type: BrokerType) => {
    if (confirm(`${BROKER_INFO[type].name} 설정을 삭제하시겠습니까?`)) {
      BrokerConfigManager.removeBrokerConfig(type);
      setConfigs({ ...configs, [type]: null });
      setEditingBroker(null);
    }
  };

  // 클라이언트 사이드 마운트 전까지 로딩 상태 표시
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
              API Key는 마스터 패스워드로 암호화되어 저장됩니다. AES-256-GCM + PBKDF2 사용
            </p>
          </div>

          {masterPasswordMode === 'setup' && (
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
                      const validation = validateMasterPassword(e.target.value);
                      setPasswordErrors(validation.errors);
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
                  />
                </div>

                <Button onClick={handleSetMasterPassword} className="w-full">
                  마스터 패스워드 설정
                </Button>
              </div>
            </Card>
          )}

          {masterPasswordMode === 'verify' && (
            <Card className="border-yellow-500/20 bg-yellow-500/5 p-6">
              <h2 className="text-lg font-semibold mb-4">마스터 패스워드 인증</h2>
              <div className="space-y-4">
                <input
                  type="password"
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder="마스터 패스워드 입력"
                  className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyMasterPassword()}
                />
                <Button onClick={handleVerifyMasterPassword} className="w-full">
                  인증
                </Button>
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
                <li><strong>키 유도:</strong> PBKDF2-SHA256 (310,000 iterations)</li>
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
            실시간 시장 데이터를 수집하기 위해 증권사 API를 설정하세요. API Key는 AES-256-GCM으로 암호화하여 저장됩니다.
          </p>
        </div>
        <Button onClick={handleLock} variant="ghost" className="text-yellow-400 hover:text-yellow-300">
          <Lock size={16} />
          잠금
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {brokers.map((type) => {
          const info = BROKER_INFO[type];
          const isConfigured = isBrokerConfigured(type);
          const isEditing = editingBroker === type;
          const isLoading = loading[type];

          return (
            <Card key={type} className={isConfigured ? "border-blue-500/30 bg-blue-500/5" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-lg">{info.name}</CardTitle>
                        {isConfigured && (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>
                  </div>
                  {type !== 'kis' && (
                    <div className="px-3 py-1 rounded text-xs bg-muted text-muted-foreground">
                      준비 중
                    </div>
                  )}
                </div>
              </CardHeader>

              {isEditing ? (
                <div className="px-6 pb-6 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                      App Key
                    </label>
                    <input
                      type="text"
                      value={formData.appKey}
                      onChange={(e) => setFormData({ ...formData, appKey: e.target.value })}
                      placeholder="App Key 입력"
                      className="w-full px-3 py-2 rounded border border-border bg-muted text-sm"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                      App Secret
                    </label>
                    <div className="flex gap-2">
                      <input
                        type={showSecrets[type] ? "text" : "password"}
                        value={formData.appSecret}
                        onChange={(e) => setFormData({ ...formData, appSecret: e.target.value })}
                        placeholder="App Secret 입력"
                        className="flex-1 px-3 py-2 rounded border border-border bg-muted text-sm"
                        disabled={isLoading}
                      />
                      <button
                        onClick={() => setShowSecrets({ ...showSecrets, [type]: !showSecrets[type] })}
                        className="px-3 py-2 text-muted-foreground hover:text-foreground"
                        title={showSecrets[type] ? "숨기기" : "보기"}
                      >
                        {showSecrets[type] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => handleSave(type)}
                      disabled={isLoading}
                      className="flex-1"
                    >
                      {isLoading ? "저장 중..." : "저장"}
                    </Button>
                    <Button
                      onClick={() => setEditingBroker(null)}
                      variant="ghost"
                      disabled={isLoading}
                    >
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
                  {type === 'kis' && (
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

      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <div className="font-semibold">한국투자증권 API 설정 방법</div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li><a href="https://www.kisapi.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">KIS API 개발자 센터</a>에 가입</li>
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
            <li><strong>PBKDF2-SHA256:</strong> 310,000 iterations로 강력한 키 유도</li>
            <li><strong>Random Salt & IV:</strong> 각 저장마다 새로운 128비트 난수 생성</li>
            <li><strong>HMAC-SHA256:</strong> 데이터 무결성 및 위조 방지 검증</li>
            <li><strong>세션 저장:</strong> 마스터 패스워드는 sessionStorage에만 저장 (탭 닫으면 삭제)</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
