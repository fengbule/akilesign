import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { CheckinService } from '../src/checkin-service.js';

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
