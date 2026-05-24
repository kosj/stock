// 증권사 API 설정 관리 (클라이언트 사이드)
import { encrypt, decrypt } from './crypto';
import type { BrokerType, BrokerCredentials } from './server/providers';

const STORAGE_KEY_PREFIX = 'broker-config-';

export interface StoredBrokerConfig {
  type: BrokerType;
  encrypted: string;
  savedAt: number;
}

export class BrokerConfigManager {
  // 특정 증권사 설정 저장
  static saveBrokerConfig(type: BrokerType, credentials: BrokerCredentials): void {
    try {
      const encrypted = encrypt(JSON.stringify(credentials));
      const config: StoredBrokerConfig = {
        type,
        encrypted,
        savedAt: Date.now()
      };
      const storageKey = `${STORAGE_KEY_PREFIX}${type}`;
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch (error) {
      console.error(`Failed to save ${type} config:`, error);
      throw new Error(`${type} 설정 저장 실패`);
    }
  }

  // 특정 증권사 설정 조회
  static getBrokerConfig(type: BrokerType): BrokerCredentials | null {
    try {
      const storageKey = `${STORAGE_KEY_PREFIX}${type}`;
      const configStr = localStorage.getItem(storageKey);
      if (!configStr) return null;

      const config: StoredBrokerConfig = JSON.parse(configStr);
      const decrypted = decrypt(config.encrypted);
      return JSON.parse(decrypted);
    } catch (error) {
      console.error(`Failed to get ${type} config:`, error);
      return null;
    }
  }

  // 특정 증권사 설정 삭제
  static removeBrokerConfig(type: BrokerType): void {
    try {
      const storageKey = `${STORAGE_KEY_PREFIX}${type}`;
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error(`Failed to remove ${type} config:`, error);
    }
  }

  // 모든 증권사 설정 조회
  static getAllBrokerConfigs(): Record<BrokerType, BrokerCredentials | null> {
    const types: BrokerType[] = ['kis', 'kb', 'shinhan', 'meritz'];
    const result: Record<BrokerType, BrokerCredentials | null> = {
      kis: null,
      kb: null,
      shinhan: null,
      meritz: null
    };

    types.forEach(type => {
      result[type] = this.getBrokerConfig(type);
    });

    return result;
  }

  // 설정된 증권사 목록
  static getConfiguredBrokers(): BrokerType[] {
    return (['kis', 'kb', 'shinhan', 'meritz'] as BrokerType[]).filter(
      type => this.getBrokerConfig(type) !== null
    );
  }

  // 기본 증권사 설정 (첫 번째로 설정된 증권사)
  static getDefaultBroker(): BrokerType | null {
    const configured = this.getConfiguredBrokers();
    return configured.length > 0 ? configured[0] : null;
  }
}

// API Key 저장 상태 확인 (UI용)
export function isBrokerConfigured(type: BrokerType): boolean {
  return BrokerConfigManager.getBrokerConfig(type) !== null;
}

export function getConfiguredBrokersList(): BrokerType[] {
  return BrokerConfigManager.getConfiguredBrokers();
}
