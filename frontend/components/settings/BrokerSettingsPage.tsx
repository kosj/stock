"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrokerConfigManager, type BrokerType, isBrokerConfigured, getConfiguredBrokersList } from "@/lib/apiConfig";
import { CheckCircle, AlertCircle, Eye, EyeOff, Trash2 } from "lucide-react";

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

  // 초기 로드
  useEffect(() => {
    const allConfigs = BrokerConfigManager.getAllBrokerConfigs();
    setConfigs(allConfigs);
  }, []);

  // 편집 시작
  const handleEditStart = (type: BrokerType) => {
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
      // 여기서 백엔드로 credentials 검증 요청 가능
      // const isValid = await api.validateBrokerCredentials(type, formData);
      // if (!isValid) throw new Error('Invalid credentials');

      BrokerConfigManager.saveBrokerConfig(type, formData);
      setConfigs({ ...configs, [type]: formData });
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">증권사 API 설정</h1>
        <p className="text-sm text-muted-foreground">
          실시간 시장 데이터를 수집하기 위해 증권사 API를 설정하세요. API Key는 로컬에서만 사용되며, 암호화하여 저장됩니다.
        </p>
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
    </div>
  );
}
