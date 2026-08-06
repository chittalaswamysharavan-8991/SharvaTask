import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CONTROL_CENTER_COOKIE = 'sharvatask_control_center';
const ACCESS_KEY_HASH = '1bc3c49366c74aa8e5adff7efdf245a46cbced39051d820ed61de37cc4e59b62';
const SESSION_VERSION = 'v1';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signingSecret(): string {
  const secret = process.env.SHARVATASK_CONTROL_CENTER_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new Error('Control center signing secret is unavailable.');
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyControlCenterAccessKey(accessKey: string): boolean {
  return safeEqual(sha256(accessKey.trim()), ACCESS_KEY_HASH);
}

export function createControlCenterSession(): { token: string; expires: Date } {
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  const payload = `${SESSION_VERSION}.${expires.getTime()}`;
  const signature = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expires };
}

export function verifyControlCenterSession(token?: string): boolean {
  if (!token) return false;
  const [version, expiresRaw, signature] = token.split('.');
  if (version !== SESSION_VERSION || !expiresRaw || !signature) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `${version}.${expiresRaw}`;
  const expected = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return safeEqual(signature, expected);
}
