import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { AkileClient, AkileApiError } from './akile-client.js';
import { CheckinService, localParts } from './checkin-service.js';
import { cookies, makeSession, verifyPassword, verifySession } from './auth.js';

const config = loadConfig();
const db = openDatabase(config.dataDir);
const client = new AkileClient({ baseUrl: config.apiBase });
const service = new CheckinService({
  db,
  client,
  encryptionKey: config.encryptionKey,
  timezone: config.timezone,
  checkinTime: config.checkinTime
});
const app = express();
const loginAttempts = new Map();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '32kb' }));

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    path: '/',
    maxAge: config.sessionHours * 3_600_000
  };
}

function authenticated(req) {
  return verifySession(cookies(req.headers.cookie).akile_session, config.sessionSecret);
}

function requireAuth(req, res, next) {
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录管理面板' });
  next();
}

function requireSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'akile-ui') return res.status(403).json({ error: '请求来源验证失败' });
  const origin = req.get('origin');
  if (origin) {
    try {
      const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim();
      const expected = config.publicOrigin || new URL(`${req.protocol}://${forwardedHost || req.get('host')}`).origin;
      if (new URL(origin).origin !== expected) return res.status(403).json({ error: '请求来源验证失败' });
    } catch { return res.status(403).json({ error: '请求来源验证失败' }); }
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/session', (req, res) => res.json({ authenticated: authenticated(req) }));

app.post('/api/login', requireSameOrigin, (req, res) => {
  const key = req.ip || 'unknown';
  const attempt = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };
  if (attempt.blockedUntil > Date.now()) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  if (!verifyPassword(req.body?.password, config.adminPassword)) {
    attempt.count += 1;
    if (attempt.count >= 5) {
      attempt.count = 0;
      attempt.blockedUntil = Date.now() + 10 * 60_000;
    }
    loginAttempts.set(key, attempt);
    return res.status(401).json({ error: '管理密码不正确' });
  }
  loginAttempts.delete(key);
  res.cookie('akile_session', makeSession(config.sessionSecret, config.sessionHours), sessionCookieOptions());
  res.json({ ok: true });
});

app.post('/api/logout', requireSameOrigin, (req, res) => {
  res.clearCookie('akile_session', { ...sessionCookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

app.use('/api', requireAuth, requireSameOrigin);

app.get('/api/status', (req, res) => res.json({
  checkinTime: config.checkinTime,
  timezone: config.timezone,
  currentDate: localParts(config.timezone).date,
  accountCount: service.listAccounts().length
}));
app.get('/api/accounts', (req, res) => res.json({ accounts: service.listAccounts() }));
app.get('/api/logs', (req, res) => res.json({ logs: service.listLogs(req.query.limit) }));
app.post('/api/accounts', asyncRoute(async (req, res) => {
  const account = await service.addAccount(req.body?.label, req.body?.token);
  res.status(201).json({ account });
}));
app.put('/api/accounts/:id/token', asyncRoute(async (req, res) => {
  const account = await service.replaceToken(Number(req.params.id), req.body?.token);
  res.json({ account });
}));
app.patch('/api/accounts/:id', (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled 必须是布尔值' });
  res.json({ account: service.setEnabled(Number(req.params.id), req.body.enabled) });
});
app.post('/api/accounts/:id/run', asyncRoute(async (req, res) => {
  res.json({ account: await service.runAccount(Number(req.params.id), 'manual') });
}));
app.post('/api/accounts/:id/verify', asyncRoute(async (req, res) => {
  res.json({ account: await service.verifyAccount(Number(req.params.id)) });
}));
app.delete('/api/accounts/:id', (req, res) => {
  service.deleteAccount(Number(req.params.id));
  res.json({ ok: true });
});

app.use(express.static(publicDir, { etag: true, maxAge: '1h' }));
app.get('*splat', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, req, res, next) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.error(`[${requestId}]`, error);
  // An expired Akile token must not log the operator out of this management panel.
  const status = error instanceof AkileApiError ? 502 : (error.status === 401 ? 401 : 400);
  res.status(status).json({ error: String(error.message || '请求失败'), requestId });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Akile check-in service listening on :${config.port}`);
  console.log(`Schedule: ${config.checkinTime} ${config.timezone}`);
});

const timer = setInterval(() => service.runDueAccounts().catch(error => console.error('scheduler', error)), 60_000);
timer.unref();
setTimeout(() => service.runDueAccounts().catch(error => console.error('startup scheduler', error)), 3_000).unref();

function shutdown() {
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
