/**
 * 증권사 API 설정 관리 (클라이언트 사이드).
 * Web Crypto API 기반 — 외부 패키지 의존성 없음.
 */

import { encryptWithPassword, decryptWithPassword, hashPassword } from "./crypto";
import type { BrokerType, BrokerCredentials } from "./server/providers";

export type { BrokerType, BrokerCredentials } from "./server/providers";

const STORAGE_KEY_PREFIX   = "broker-config-";
const MASTER_PWD_HASH_KEY  = "__master_pwd_hash__";
const MASTER_PWD_KEY       = "__master_password__";
const MASTER_PWD_SET_KEY   = "__master_password_set__";

export interface StoredBrokerConfig {
  type: BrokerType;
  encrypted: string;
  savedAt: number;
  algorithm: "aes-256-cbc-hmac";
}

function isClient(): boolean {
  return typeof window !== "undefined";
}

// ---------------------------------------------------------------------------
// BrokerConfigManager
// ---------------------------------------------------------------------------

export class BrokerConfigManager {
  /** 마스터 패스워드 설정 (비동기 — SHA-256 해시 생성 필요) */
  static async setMasterPassword(password: string): Promise<void> {
    if (!isClient()) throw new Error("클라이언트 환경에서만 사용 가능합니다");
    if (!password || password.length < 8) throw new Error("마스터 패스워드는 최소 8자 이상이어야 합니다");
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error("마스터 패스워드는 대문자, 소문자, 숫자를 포함해야 합니다");
    }
    const hash = await hashPassword(password);
    sessionStorage.setItem(MASTER_PWD_HASH_KEY, hash);
    sessionStorage.setItem(MASTER_PWD_SET_KEY, "true");
    sessionStorage.setItem(MASTER_PWD_KEY, password);
  }

  /** 마스터 패스워드 검증 (비동기) */
  static async verifyMasterPassword(password: string): Promise<boolean> {
    if (!isClient()) return false;
    const stored = sessionStorage.getItem(MASTER_PWD_HASH_KEY);
    if (!stored) return false;
    const hash = await hashPassword(password);
    if (hash !== stored) return false;
    // 검증 성공 시 세션에 저장
    sessionStorage.setItem(MASTER_PWD_KEY, password);
    return true;
  }

  static isMasterPasswordSet(): boolean {
    if (!isClient()) return false;
    return sessionStorage.getItem(MASTER_PWD_SET_KEY) === "true";
  }

  static clearMasterPassword(): void {
    if (!isClient()) return;
    sessionStorage.removeItem(MASTER_PWD_KEY);
    sessionStorage.removeItem(MASTER_PWD_SET_KEY);
    sessionStorage.removeItem(MASTER_PWD_HASH_KEY);
  }

  /** 증권사 설정 저장 (비동기 — AES 암호화 필요) */
  static async saveBrokerConfig(type: BrokerType, credentials: BrokerCredentials): Promise<void> {
    const masterPassword = sessionStorage.getItem(MASTER_PWD_KEY);
    if (!masterPassword) throw new Error("마스터 패스워드로 인증 후 사용할 수 있습니다");

    const encrypted = await encryptWithPassword(JSON.stringify(credentials), masterPassword);
    const config: StoredBrokerConfig = {
      type,
      encrypted,
      savedAt: Date.now(),
      algorithm: "aes-256-cbc-hmac",
    };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${type}`, JSON.stringify(config));
  }

  /** 증권사 설정 조회 (비동기 — AES 복호화 필요) */
  static async getBrokerConfig(type: BrokerType): Promise<BrokerCredentials | null> {
    if (!isClient()) return null;
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${type}`);
    if (!raw) return null;
    const masterPassword = sessionStorage.getItem(MASTER_PWD_KEY);
    if (!masterPassword) return null;
    try {
      const config: StoredBrokerConfig = JSON.parse(raw);
      const decrypted = await decryptWithPassword(config.encrypted, masterPassword);
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  static removeBrokerConfig(type: BrokerType): void {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${type}`);
  }

  static hasBrokerConfig(type: BrokerType): boolean {
    if (!isClient()) return false;
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${type}`) !== null;
  }

  static getConfiguredBrokers(): BrokerType[] {
    return (["kis", "kb", "shinhan", "meritz"] as BrokerType[]).filter(
      (t) => BrokerConfigManager.hasBrokerConfig(t),
    );
  }

  /** 기본 증권사의 자격증명 반환 (비동기) — 대시보드/종목 페이지에서 사용 */
  static async getDefaultBrokerConfig(): Promise<{ type: BrokerType; credentials: BrokerCredentials } | null> {
    const types = BrokerConfigManager.getConfiguredBrokers();
    for (const type of types) {
      const creds = await BrokerConfigManager.getBrokerConfig(type);
      if (creds) return { type, credentials: creds };
    }
    return null;
  }
}

export function isBrokerConfigured(type: BrokerType): boolean {
  return BrokerConfigManager.hasBrokerConfig(type);
}

export function getConfiguredBrokersList(): BrokerType[] {
  return BrokerConfigManager.getConfiguredBrokers();
}

// ---------------------------------------------------------------------------
// 단순 API 키 관리 (Anthropic, FRED) — 암호화 없이 localStorage
// ---------------------------------------------------------------------------

const SIMPLE_KEY_PREFIX = "api-key-";
export type SimpleApiKeyType = "anthropic" | "fred";

export class ApiKeyManager {
  static saveKey(name: SimpleApiKeyType, value: string): void {
    if (!isClient()) return;
    if (value) localStorage.setItem(`${SIMPLE_KEY_PREFIX}${name}`, value);
    else localStorage.removeItem(`${SIMPLE_KEY_PREFIX}${name}`);
  }

  static getKey(name: SimpleApiKeyType): string {
    if (!isClient()) return "";
    return localStorage.getItem(`${SIMPLE_KEY_PREFIX}${name}`) ?? "";
  }

  static removeKey(name: SimpleApiKeyType): void {
    if (!isClient()) return;
    localStorage.removeItem(`${SIMPLE_KEY_PREFIX}${name}`);
  }

  static hasKey(name: SimpleApiKeyType): boolean {
    return ApiKeyManager.getKey(name).length > 0;
  }
}
