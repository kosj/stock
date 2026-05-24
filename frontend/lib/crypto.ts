// 최상급 보안 클라이언트 사이드 암호화/복호화 유틸리티
// - AES-256-CBC: 산업 표준 블록 암호화 (NIST 승인)
// - PBKDF2: 마스터 패스워드로부터 256비트 키 유도 (iterations: 310000)
// - Random salt & IV: 각 암호화마다 새로운 salt와 IV 생성
// - HMAC-SHA256: 무결성 및 인증 검증

import CryptoJS from 'crypto-js';

const PBKDF2_ITERATIONS = 310000; // OWASP 권장사항 (2024)
const KEY_LENGTH = 256; // 256비트
const IV_LENGTH = 128; // 128비트 (AES 블록 크기)
const SALT_LENGTH = 128; // 128비트 salt

export interface EncryptedData {
  version: number; // 버전 관리 (향후 호환성)
  algorithm: string; // 'aes-256-cbc-hmac'
  salt: string; // hex encoded (PBKDF2 salt)
  iv: string; // hex encoded (AES IV)
  ciphertext: string; // hex encoded
  hmac: string; // HMAC-SHA256 (무결성 검증)
  timestamp: number; // 암호화 시간
}

// 난수 생성 (Web Crypto API 사용)
function generateRandomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length / 8);
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(buffer);
  } else {
    // Fallback (Node.js 환경)
    const crypto = require('crypto');
    crypto.randomFillSync(buffer);
  }
  return buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// PBKDF2로 마스터 패스워드로부터 암호화 키 유도
function deriveKeyFromPassword(password: string, salt: Uint8Array): CryptoJS.lib.WordArray {
  const saltHex = CryptoJS.enc.Hex.parse(bytesToHex(salt));

  // CryptoJS.PBKDF2 사용
  const key = CryptoJS.PBKDF2(password, saltHex, {
    keySize: KEY_LENGTH / 32, // 32비트 단위
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  });

  return key;
}

// 최상급 보안 암호화 (마스터 패스워드 기반)
// AES-256-CBC + PBKDF2 + HMAC-SHA256
export function encryptWithPassword(plaintext: string, masterPassword: string): string {
  try {
    // 1. Random salt 생성 (128비트)
    const salt = generateRandomBytes(SALT_LENGTH);

    // 2. 마스터 패스워드로부터 키 유도 (PBKDF2)
    const key = deriveKeyFromPassword(masterPassword, salt);

    // 3. Random IV 생성 (128비트)
    const iv = generateRandomBytes(IV_LENGTH);

    // 4. AES-256-CBC 암호화
    const plaintextWords = CryptoJS.enc.Utf8.parse(plaintext);
    const ivWords = CryptoJS.enc.Hex.parse(bytesToHex(iv));

    const encrypted = CryptoJS.AES.encrypt(plaintextWords, key, {
      iv: ivWords,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    const ciphertext = encrypted.ciphertext.toString();

    // 5. HMAC-SHA256 계산 (무결성 검증용)
    const hmacInput = bytesToHex(salt) + bytesToHex(iv) + ciphertext;
    const hmac = CryptoJS.HmacSHA256(hmacInput, key).toString();

    // 6. 결과 조합
    const result: EncryptedData = {
      version: 1,
      algorithm: 'aes-256-cbc-hmac',
      salt: bytesToHex(salt),
      iv: bytesToHex(iv),
      ciphertext: ciphertext,
      hmac: hmac,
      timestamp: Date.now()
    };

    // 7. JSON으로 변환 후 Base64 인코딩
    return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(result)));
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error(`암호화 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 복호화
export function decryptWithPassword(encryptedData: string, masterPassword: string): string {
  try {
    // 1. Base64 디코딩
    const decoded = CryptoJS.enc.Base64.parse(encryptedData).toString(CryptoJS.enc.Utf8);
    const data: EncryptedData = JSON.parse(decoded);

    // 2. 버전 확인
    if (data.version !== 1) {
      throw new Error('지원하지 않는 암호화 버전');
    }

    // 3. Salt로부터 키 유도
    const saltBytes = hexToBytes(data.salt);
    const key = deriveKeyFromPassword(masterPassword, saltBytes);

    // 4. HMAC 검증 (무결성 확인)
    const hmacInput = data.salt + data.iv + data.ciphertext;
    const expectedHmac = CryptoJS.HmacSHA256(hmacInput, key).toString();
    if (expectedHmac !== data.hmac) {
      throw new Error('데이터 무결성 검증 실패: HMAC 불일치');
    }

    // 5. AES-256-CBC 복호화
    const ivWords = CryptoJS.enc.Hex.parse(data.iv);

    const decrypted = CryptoJS.AES.decrypt(
      data.ciphertext,
      key,
      {
        iv: ivWords,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    // 6. UTF-8로 디코딩
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error(`복호화 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 하위 호환성: 패스워드 없는 버전 (내부 사용 전용 - 마스터 패스워드로 자동 사용)
export function encrypt(text: string, password?: string): string {
  // 마스터 패스워드가 없으면 sessionStorage에서 가져오기
  const masterPassword = password || sessionStorage.getItem('__master_password__') || 'default-password';
  return encryptWithPassword(text, masterPassword);
}

export function decrypt(encrypted: string, password?: string): string {
  const masterPassword = password || sessionStorage.getItem('__master_password__') || 'default-password';
  return decryptWithPassword(encrypted, masterPassword);
}
