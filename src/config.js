import crypto from 'node:crypto';
import path from 'node:path';

function required(name, minimumLength = 1) {
  const value = String(process.env[name] || '');
  if (value.length < minimumLength) {
    throw new Error(`${name} is required and must contain at least ${minimumLength} characters`);
  }
  return value;
}

export function parseEncryptionKey(value) {
  const text = String(value || '').trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(text)) key = Buffer.from(text, 'hex');
  else key = Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return key;
}

export function loadConfig() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');

  const checkinTime = String(process.env.CHECKIN_TIME || '09:10');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(checkinTime)) throw new Error('CHECKIN_TIME must use HH:mm');

  return {
    port,
    dataDir: path.resolve(process.env.DATA_DIR || './data'),
    adminPassword: required('ADMIN_PASSWORD', 12),
    sessionSecret: required('SESSION_SECRET', 32),
    encryptionKey: parseEncryptionKey(required('TOKEN_ENCRYPTION_KEY', 32)),
    checkinTime,
    timezone: String(process.env.TZ || 'Asia/Shanghai'),
    apiBase: String(process.env.AKILE_API_BASE || 'https://api.akile.ai/api').replace(/\/+$/, ''),
    secureCookie: String(process.env.SECURE_COOKIE || 'true').toLowerCase() !== 'false',
    sessionHours: Math.max(1, Number(process.env.SESSION_HOURS || 24)),
    instanceId: crypto.randomUUID()
  };
}
