// 증권사 API 설정 관리 (클라이언트 사이드) - 최상급 보안
// AES-256-GCM + PBKDF2(310000 iterations) + 마스터 패스워드

import { encryptWithPassword, decryptWithPassword } from './crypto';
import type { BrokerType, BrokerCredentials } from './server/providers';

// 다른 모듈에서 import 할 수 있도록 re-export
export type { BrokerType, BrokerCredentials } from './server/providers';

const STORAGE_KEY_PREFIX = 'broker-config-';
const MASTER_PASSWORD_HASH_KEY = '__master_pwd_hash__';

export interface StoredBrokerConfig {
  type: BrokerType;
  encrypted: string; // AES-256-GCM으로 암호화된 credentials
  savedAt: number;
  algorithm: 'aes-256-gcm';
}

export class BrokerConfigManager {
  // 마스터 패스워드 설정 (해시로 저장, 복호화할 때는 원본 필요)
  static setMasterPassword(password: string): void {
    try {
      if (!password || password.length < 8) {
        throw new Error('마스터 패스워드는 최소 8자 이상이어야 합니다');
      }

      // 패스워드 강도 검증
      const hasUpperCase = /[A-Z]/.test(password);
      const hasLowerCase = /[a-z]/.test(password);
      const hasNumbers = /[0-9]/.test(password);
      const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

      if (!(hasUpperCase && hasLowerCase && hasNumbers)) {
        throw new Error('마스터 패스워드는 대문자, 소문자, 숫자를 포함해야 합니다');
      }

      // 간단한 해시 (검증용): SHA256 of password
      const hash = require('crypto').createHash('sha256').update(password).digest('hex');
      sessionStorage.setItem(MASTER_PASSWORD_HASH_KEY, hash);
      sessionStorage.setItem('__master_password_set__', 'true');

      // 세션 메모리에 마스터 패스워드 저장 (복호화용)
      sessionStorage.setItem('__master_password__', password);
    } catch (error) {
      console.error('Failed to set master password:', error);
      throw error;
    }
  }

  // 마스터 패스워드 확인
  static verifyMasterPassword(password: string): boolean {
    try {
      const hash = require('crypto').createHash('sha256').update(password).digest('hex');
      const storedHash = sessionStorage.getItem(MASTER_PASSWORD_HASH_KEY);
      return hash === storedHash;
    } catch (error) {
      console.error('Failed to verify master password:', error);
      return false;
    }
  }

  // 마스터 패스워드 설정 여부 확인
  static isMasterPasswordSet(): boolean {
    return sessionStorage.getItem('__master_password_set__') === 'true';
  }

  // 마스터 패스워드 초기화 (로그아웃 시 호출)
  static clearMasterPassword(): void {
    sessionStorage.removeItem('__master_password__');
    sessionStorage.removeItem('__master_password_set__');
    sessionStorage.removeItem(MASTER_PASSWORD_HASH_KEY);
  }

  // 특정 증권사 설정 저장 (마스터 패스워드 필수)
  static saveBrokerConfig(type: BrokerType, credentials: BrokerCredentials, masterPassword: string): void {
    try {
      if (!this.verifyMasterPassword(masterPassword)) {
        throw new Error('마스터 패스워드가 일치하지 않습니다');
      }

      // AES-256-GCM으로 암호화 (마스터 패스워드 사용)
      const encrypted = encryptWithPassword(JSON.stringify(credentials), masterPassword);

      const config: StoredBrokerConfig = {
        type,
        encrypted,
        savedAt: Date.now(),
        algorithm: 'aes-256-gcm'
      };

      const storageKey = `${STORAGE_KEY_PREFIX}${type}`;
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch (error) {
      console.error(`Failed to save ${type} config:`, error);
      throw error;
    }
  }

  // 특정 증권사 설정 조회
  static getBrokerConfig(type: BrokerType): BrokerCredentials | null {
    try {
      const storageKey = `${STORAGE_KEY_PREFIX}${type}`;
      const configStr = localStorage.getItem(storageKey);
      if (!configStr) return null;

      const config: StoredBrokerConfig = JSON.parse(configStr);

      // 마스터 패스워드가 세션에 없으면 null
      const masterPassword = sessionStorage.getItem('__master_password__');
      if (!masterPassword) {
        console.warn(`Master password not found in session for ${type}`);
        return null;
      }

      // AES-256-GCM으로 복호화
      const decrypted = decryptWithPassword(config.encrypted, masterPassword);
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
      throw error;
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

// 유틸리티 함수
export function isBrokerConfigured(type: BrokerType): boolean {
  return BrokerConfigManager.getBrokerConfig(type) !== null;
}

export function getConfiguredBrokersList(): BrokerType[] {
  return BrokerConfigManager.getConfiguredBrokers();
}
