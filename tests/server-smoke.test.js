import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

test('server starts, authenticates, and returns the account list', { timeout: 15_000 }, async t => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akile-server-test-'));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_PASSWORD: 'smoke-test-password-only',
      SESSION_SECRET: 's'.repeat(64),
      TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      SECURE_COOKIE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      health = await fetch(`${base}/healthz`);
      if (health.ok) break;
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(health?.ok, `server failed to start: ${stderr}`);

  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'akile-ui' },
    body: JSON.stringify({ password: 'smoke-test-password-only' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const accounts = await fetch(`${base}/api/accounts`, { headers: { cookie } });
  assert.equal(accounts.status, 200);
  assert.deepEqual((await accounts.json()).accounts, []);
});
