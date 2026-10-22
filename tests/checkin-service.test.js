import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { CheckinService } from '../src/checkin-service.js';
import { AkileApiError } from '../src/akile-client.js';
import { decryptToken } from '../src/token-crypto.js';

test('an account can be bound, run, listed, and deleted without exposing its token', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akile-service-test-'));
  const db = openDatabase(dir);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const fakeClient = {
    validateToken: async () => ({ username: 'tester', coinTotal: 10 }),
    checkIn: async token => {
      assert.equal(token, 'test-token-that-is-long-enough');
      return { status: 'success', message: 'ok', coinTotal: 15, earned: 5, token, tokenRefreshed: false };
    }
  };
  const service = new CheckinService({
    db, client: fakeClient, encryptionKey: crypto.randomBytes(32), timezone: 'Asia/Shanghai', checkinTime: '09:10'
  });
  const added = await service.addAccount('测试账号', 'test-token-that-is-long-enough');
  assert.equal(added.username, 'tester');
  assert.equal(added.authStatus, 'valid');
  assert.equal('token' in added, false);
  const verified = await service.verifyAccount(added.id);
  assert.equal(verified.authStatus, 'valid');
  assert.ok(verified.lastValidatedAt);
  const result = await service.runAccount(added.id);
  assert.equal(result.status, 'success');
  assert.equal(result.coinTotal, 15);
  assert.equal(service.listLogs().some(log => log.event === 'checkin_success'), true);
  service.deleteAccount(added.id);
  assert.equal(service.listAccounts().length, 0);
});

async function scheduledService(t, checkIn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akile-schedule-test-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let now = new Date('2026-10-22T01:10:00Z');
  const encryptionKey = crypto.randomBytes(32);
  const client = {
    validateToken: async () => ({ username: 'tester', coinTotal: 10 }),
    checkIn
  };
  const service = new CheckinService({ db, client, encryptionKey, timezone: 'Asia/Shanghai', checkinTime: '09:10', clock: () => now });
  const account = await service.addAccount('主账号', 'test-token-that-is-long-enough');
  return { service, db, account, encryptionKey, advance: minutes => { now = new Date(now.getTime() + minutes * 60_000); } };
}

for (const status of ['success', 'already']) {
  test(`scheduled ${status} is not requested again that day and resumes next day`, async t => {
    let calls = 0;
    const ctx = await scheduledService(t, async token => { calls += 1; return { status, coinTotal: 10, earned: 0, token }; });
    assert.equal((await ctx.service.runDueAccounts()).length, 1);
    ctx.advance(15);
    assert.equal((await ctx.service.runDueAccounts()).length, 0);
    ctx.advance(24 * 60);
    assert.equal((await ctx.service.runDueAccounts()).length, 1);
    assert.equal(calls, 2);
  });
}

test('temporary failures retry only after 15 minutes and at most three times daily', async t => {
  let calls = 0;
  const ctx = await scheduledService(t, async () => { calls += 1; throw new Error('upstream unavailable'); });
  await ctx.service.runDueAccounts();
  ctx.advance(14);
  assert.equal((await ctx.service.runDueAccounts()).length, 0);
  ctx.advance(1);
  await ctx.service.runDueAccounts();
  ctx.advance(15);
  await ctx.service.runDueAccounts();
  ctx.advance(15);
  assert.equal((await ctx.service.runDueAccounts()).length, 0);
  assert.equal(calls, 3);
});

test('an invalid login stops scheduled requests until the token is replaced', async t => {
  let calls = 0;
  const ctx = await scheduledService(t, async () => { calls += 1; throw new AkileApiError('登录已失效', 401); });
  await ctx.service.runDueAccounts();
  ctx.advance(24 * 60);
  assert.equal((await ctx.service.runDueAccounts()).length, 0);
  await ctx.service.replaceToken(ctx.account.id, 'a-new-valid-token-with-enough-length');
  await ctx.service.runDueAccounts();
  assert.equal(calls, 2);
});

test('refreshed credentials and expiry survive a failed check-in', async t => {
  const expiry = 2_000_000_000;
  const newToken = `x.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.refreshed-signature`;
  const ctx = await scheduledService(t, async (token, { onTokenRefreshed }) => {
    await onTokenRefreshed(newToken);
    throw new Error('network interrupted after refresh');
  });
  await assert.rejects(() => ctx.service.runAccount(ctx.account.id));
  const stored = ctx.service.getAccount(ctx.account.id);
  assert.equal(decryptToken(stored, ctx.encryptionKey), newToken);
  assert.equal(stored.token_expires_at, new Date(expiry * 1000).toISOString());
  assert.equal(JSON.stringify(ctx.service.listAccounts()).includes(newToken), false);
});
