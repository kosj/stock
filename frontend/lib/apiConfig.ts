/** Legacy browser credential compatibility. Broker secrets now live only in the
 * authenticated /api/settings/broker flow. Optional API keys live in tab memory. */
import type { BrokerType, BrokerCredentials } from "./server/providers";
export type { BrokerType, BrokerCredentials } from "./server/providers";

const LEGACY_KEYS = ["__master_password__", "__master_pwd_hash__", "kis-token-cache",
  "api-key-anthropic", "api-key-fred", ...["kis", "kb", "shinhan", "meritz", "miraeasset"].map((t) => `broker-config-${t}`)];

/** Storage may be disabled; cleanup failures never restore old secrets. */
export function purgeLegacyCredentials(): void {
  if (typeof window === "undefined") return;
  for (const store of ["localStorage", "sessionStorage"] as const) {
    try { for (const key of LEGACY_KEYS) window[store].removeItem(key); } catch { /* storage unavailable */ }
  }
}
purgeLegacyCredentials();

export interface StoredBrokerConfig {
  type: BrokerType;
  encrypted: string;
  savedAt: number;
  algorithm: "aes-256-cbc-hmac";
}

/** Legacy consumers receive no browser credentials and use server/default market data. */
export class BrokerConfigManager {
  static async setMasterPassword(_password: string): Promise<void> {
    void _password;
    purgeLegacyCredentials();
    throw new Error("설정 → API 설정에서 증권사 키를 서버에 저장해주세요. 브라우저 마스터 비밀번호는 사용하지 않습니다.");
  }
  static async verifyMasterPassword(_password: string): Promise<boolean> { void _password; purgeLegacyCredentials(); return false; }
  static isMasterPasswordSet(): boolean { purgeLegacyCredentials(); return false; }
  static isSessionUnlocked(): boolean { purgeLegacyCredentials(); return false; }
  static clearMasterPassword(): void { purgeLegacyCredentials(); }
  static resetMasterPassword(): void { purgeLegacyCredentials(); }
  static async saveBrokerConfig(type: BrokerType, credentials: BrokerCredentials): Promise<void> {
    purgeLegacyCredentials();
    const response = await fetch("/api/settings/broker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...credentials }),
    });
    if (!response.ok) throw new Error("증권사 키 저장 실패. 설정 → API 설정에서 다시 등록해주세요.");
  }
  static async getBrokerConfig(_type: BrokerType): Promise<BrokerCredentials | null> { void _type; purgeLegacyCredentials(); return null; }
  static removeBrokerConfig(_type: BrokerType): void { void _type; purgeLegacyCredentials(); }
  static hasBrokerConfig(_type: BrokerType): boolean { void _type; purgeLegacyCredentials(); return false; }
  static getConfiguredBrokers(): BrokerType[] { purgeLegacyCredentials(); return []; }
  static async getDefaultBrokerConfig(): Promise<{ type: BrokerType; credentials: BrokerCredentials } | null> {
    purgeLegacyCredentials(); return null;
  }
}
export function isBrokerConfigured(type: BrokerType): boolean { return BrokerConfigManager.hasBrokerConfig(type); }
export function getConfiguredBrokersList(): BrokerType[] { return BrokerConfigManager.getConfiguredBrokers(); }

export type SimpleApiKeyType = "anthropic" | "fred";
const tabKeys = new Map<SimpleApiKeyType, string>();
export class ApiKeyManager {
  static clearKeys(): void { purgeLegacyCredentials(); tabKeys.clear(); }
  static saveKey(name: SimpleApiKeyType, value: string): void {
    purgeLegacyCredentials();
    if (typeof window === "undefined") return;
    if (value.trim()) tabKeys.set(name, value.trim()); else tabKeys.delete(name);
  }
  static getKey(name: SimpleApiKeyType): string { purgeLegacyCredentials(); return tabKeys.get(name) ?? ""; }
  static removeKey(name: SimpleApiKeyType): void { purgeLegacyCredentials(); tabKeys.delete(name); }
  static hasKey(name: SimpleApiKeyType): boolean { return ApiKeyManager.getKey(name).length > 0; }
}
