/**
 * 브라우저 내장 Web Crypto API 기반 암호화 유틸리티.
 * 외부 패키지 의존성 없음. 모든 최신 브라우저에서 동작.
 *
 * - AES-256-CBC + PBKDF2-SHA256 (100,000 iterations)
 * - HMAC-SHA256 무결성 검증
 */

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

// TypeScript 5: Uint8Array<ArrayBufferLike>가 BufferSource 불일치 → ArrayBuffer 명시
function toBuffer(arr: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Uint8Array(buf);
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return toBuffer(crypto.getRandomValues(new Uint8Array(n)));
}

function encode(text: string): Uint8Array<ArrayBuffer> {
  return toBuffer(new TextEncoder().encode(text));
}

function bufToHex(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) {
    view[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return view;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw", encode(password), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-CBC", length: KEY_LEN_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

async function hmacKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw", encode(password), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface EncryptedData {
  version: number;
  algorithm: string;
  salt: string;
  iv: string;
  ciphertext: string;
  hmac: string;
  timestamp: number;
}

export async function encryptWithPassword(
  plaintext: string,
  masterPassword: string,
): Promise<string> {
  const salt = randomBytes(16);
  const iv   = randomBytes(16);

  const aesKey = await deriveKey(masterPassword, salt);
  const macKey = await hmacKey(masterPassword, salt);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv }, aesKey, encode(plaintext),
  );
  const saltHex   = bufToHex(salt);
  const ivHex     = bufToHex(iv);
  const cipherHex = bufToHex(cipherBuf);

  const macBuf = await crypto.subtle.sign(
    "HMAC", macKey, encode(saltHex + ivHex + cipherHex),
  );

  const payload: EncryptedData = {
    version: 2,
    algorithm: "aes-256-cbc-hmac",
    salt: saltHex,
    iv: ivHex,
    ciphertext: cipherHex,
    hmac: bufToHex(macBuf),
    timestamp: Date.now(),
  };
  return btoa(JSON.stringify(payload));
}

export async function decryptWithPassword(
  encryptedData: string,
  masterPassword: string,
): Promise<string> {
  const payload: EncryptedData = JSON.parse(atob(encryptedData));
  if (payload.version !== 2) throw new Error("지원하지 않는 암호화 버전");

  const salt   = hexToBuf(payload.salt);
  const iv     = hexToBuf(payload.iv);
  const cipher = hexToBuf(payload.ciphertext);
  const hmac   = hexToBuf(payload.hmac);

  const aesKey = await deriveKey(masterPassword, salt);
  const macKey = await hmacKey(masterPassword, salt);

  const valid = await crypto.subtle.verify(
    "HMAC", macKey, hmac,
    encode(payload.salt + payload.iv + payload.ciphertext),
  );
  if (!valid) throw new Error("데이터 무결성 검증 실패: HMAC 불일치");

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, cipher);
  return new TextDecoder().decode(plainBuf);
}

export async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encode(password));
  return bufToHex(buf);
}
