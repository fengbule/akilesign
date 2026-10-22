import crypto from 'node:crypto';

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyPassword(candidate, expected) {
  const left = crypto.createHash('sha256').update(String(candidate)).digest();
  const right = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

export function makeSession(secret, hours) {
  const payload = b64(JSON.stringify({ exp: Date.now() + hours * 3_600_000, nonce: crypto.randomUUID() }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value, secret) {
  try {
    const [payload, signature] = String(value || '').split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function cookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    try { return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]; }
    catch { return ['', '']; }
  }).filter(([key]) => key));
}
