// 클라이언트 사이드 암호화/복호화 유틸리티
// 주의: 절대적인 보안을 보장하지 않으므로 민감한 정보는 주의해서 사용하세요

const CIPHER_KEY = 'stock-app-cipher-key-2026';
const ALGORITHM = 'aes-256-cbc';

// Base64 유틸리티 (텍스트 기반 암호화용)
function base64Encode(text: string): string {
  return Buffer.from(text).toString('base64');
}

function base64Decode(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

// 간단한 XOR 암호화 (클라이언트 사이드 기본 보호)
// 주의: 진정한 보안을 위해서는 더 강력한 암호화 필요
export function encrypt(text: string): string {
  try {
    // 더 간단하고 브라우저 호환성 있는 방식: Base64 인코딩 + 간단한 난독화
    const encoded = base64Encode(text);
    let encrypted = '';
    for (let i = 0; i < encoded.length; i++) {
      encrypted += String.fromCharCode(encoded.charCodeAt(i) ^ CIPHER_KEY.charCodeAt(i % CIPHER_KEY.length));
    }
    return base64Encode(encrypted);
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('암호화 실패');
  }
}

export function decrypt(encrypted: string): string {
  try {
    const encoded = base64Decode(encrypted);
    let decrypted = '';
    for (let i = 0; i < encoded.length; i++) {
      decrypted += String.fromCharCode(encoded.charCodeAt(i) ^ CIPHER_KEY.charCodeAt(i % CIPHER_KEY.length));
    }
    return base64Decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('복호화 실패');
  }
}
