/**
 * 서버사이드 증권사 자격증명 암호화 저장/조회
 *
 * 암호화: AES-256-GCM (Node.js crypto 내장)
 * 저장:   Supabase user_broker_configs 테이블
 *
 * Vercel 환경변수 필요:
 *   BROKER_ENCRYPTION_KEY = 64자리 hex 문자열 (32바이트 랜덤키)
 *   생성 방법: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from "crypto";
import { supabase } from "./supabase";

export interface BrokerCredentials {
  appKey:        string;
  appSecret:     string;
  accountNumber?: string;
}

export interface BrokerConfig {
  type:          string;
  appKey:        string;
  appSecret:     string;
  accountNumber?: string;
}

// ── 암호화 / 복호화 ────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const hex = process.env.BROKER_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error(
      "BROKER_ENCRYPTION_KEY 환경변수가 없거나 형식이 잘못됐습니다. " +
      "64자리 hex 문자열(32바이트)을 Vercel 환경변수에 등록하세요.\n" +
      "생성: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plain: object): string {
  const key = getEncryptionKey();
  const iv   = crypto.randomBytes(12);                          // 96-bit GCM IV
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc  = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();                             // 128-bit auth tag
  // 저장 형식: ivHex:tagHex:encHex
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decrypt<T = BrokerCredentials>(ciphertext: string): T {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("잘못된 암호문 형식");
  const [ivHex, tagHex, encHex] = parts;
  const iv      = Buffer.from(ivHex,  "hex");
  const tag     = Buffer.from(tagHex, "hex");
  const enc     = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}

// ── DB 조작 ───────────────────────────────────────────────────────────────────

/** 증권사 자격증명 저장 (없으면 INSERT, 있으면 UPDATE) */
export async function saveBrokerConfig(
  userId:      string,
  brokerType:  string,
  credentials: BrokerCredentials,
): Promise<void> {
  const configEnc = encrypt(credentials);
  const { error } = await supabase
    .from("user_broker_configs")
    .upsert(
      {
        user_id:     userId,
        broker_type: brokerType,
        config_enc:  configEnc,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: "user_id,broker_type" },
    );
  if (error) throw new Error(`자격증명 저장 실패: ${error.message}`);
}

/** 특정 증권사 자격증명 조회 */
export async function getBrokerConfig(
  userId:     string,
  brokerType: string,
): Promise<BrokerCredentials | null> {
  const { data } = await supabase
    .from("user_broker_configs")
    .select("config_enc")
    .eq("user_id",     userId)
    .eq("broker_type", brokerType)
    .single();
  if (!data?.config_enc) return null;
  try {
    return decrypt<BrokerCredentials>(data.config_enc);
  } catch {
    return null;
  }
}

/** 첫 번째(가장 최근 갱신) 증권사 자격증명 조회 */
export async function getFirstBrokerConfig(userId: string): Promise<BrokerConfig | null> {
  const { data } = await supabase
    .from("user_broker_configs")
    .select("broker_type, config_enc")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if (!data?.config_enc) return null;
  try {
    const creds = decrypt<BrokerCredentials>(data.config_enc);
    return { type: data.broker_type, ...creds };
  } catch {
    return null;
  }
}

/** 설정된 증권사 타입 목록 */
export async function listBrokerTypes(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_broker_configs")
    .select("broker_type")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r: { broker_type: string }) => r.broker_type);
}

/** 증권사 자격증명 삭제 */
export async function deleteBrokerConfig(userId: string, brokerType: string): Promise<void> {
  await supabase
    .from("user_broker_configs")
    .delete()
    .eq("user_id",     userId)
    .eq("broker_type", brokerType);
}
