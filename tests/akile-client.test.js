import test from 'node:test';
import assert from 'node:assert/strict';
import { AkileClient, AkileApiError, jwtExpiry } from '../src/akile-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('check-in returns earned coins and sends the raw Authorization token', async () => {
  const calls = [];
  const client = new AkileClient({
    baseUrl: 'https://example.test/api',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/index')) return jsonResponse({ status_code: 0, data: { username: 'tester', ak_coin: 100 } });
      return jsonResponse({ status_code: 0, data: 107 });
    }
  });
  const result = await client.checkIn('opaque-test-token-with-enough-length');
  assert.equal(result.status, 'success');
  assert.equal(result.earned, 7);
  assert.equal(result.coinTotal, 107);
  assert.equal(calls[0].options.headers.authorization, 'opaque-test-token-with-enough-length');
  assert.equal(calls[0].options.headers.authorization.startsWith('Bearer '), false);
});

test('already checked in is an idempotent success result', async () => {
  const client = new AkileClient({
    fetchImpl: async url => url.endsWith('/index')
      ? jsonResponse({ status_code: 0, data: { username: 'tester', ak_coin: 88 } })
      : jsonResponse({ status_code: 400, status_msg: '今日已签到，请勿重复签到' })
  });
  const result = await client.checkIn('opaque-test-token-with-enough-length');
  assert.equal(result.status, 'already');
  assert.equal(result.coinTotal, 88);
  assert.equal(result.earned, 0);
});

test('HTTP 401 is reported as an authentication failure', async () => {
  const client = new AkileClient({ fetchImpl: async () => jsonResponse({ status_msg: 'token不能为空' }, 401) });
  await assert.rejects(() => client.validateToken('bad-token'), error => {
    assert.ok(error instanceof AkileApiError);
    assert.equal(error.status, 401);
    return true;
  });
});

test('JWT expiry parser supports base64url payloads', () => {
  const token = `x.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')}.x`;
  assert.equal(jwtExpiry(token), 2_000_000_000_000);
});

test('an HTTP 200 authentication error preserves its API status', async () => {
  const client = new AkileClient({ fetchImpl: async () => jsonResponse({ status_code: 401, status_msg: '登录已过期' }) });
  await assert.rejects(() => client.validateToken('expired-token'), error => error.status === 401);
});

test('empty and incomplete profiles cannot bind an account', async () => {
  for (const body of [{}, { status_code: 0 }, { status_code: 0, data: {} }]) {
    const client = new AkileClient({ fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(() => client.validateToken('opaque-token'));
  }
});

test('the current dashboard profile may contain account statistics without a username', async () => {
  const client = new AkileClient({ fetchImpl: async url => jsonResponse({ status_code: 0, data: url.endsWith('/info')
    ? { username: 'fengbule', last_checkin_time: 1792620000 }
    : { ak_coin: 4333, vps_num: 2 } }) });
  const profile = await client.validateToken('opaque-token');
  assert.equal(profile.coinTotal, 4333);
  assert.equal(profile.username, 'fengbule');
  assert.equal(profile.lastCheckinAt, 1792620000);
});

test('an unavailable balance is not reported as zero coins', async () => {
  const client = new AkileClient({ fetchImpl: async url => url.endsWith('/index')
    ? jsonResponse({ status_code: 0, data: { username: 'tester', ak_coin: null } })
    : jsonResponse({ status_code: 0, data: null }) });
  const profile = await client.validateToken('opaque-token');
  assert.equal(profile.coinTotal, null);
  const result = await client.checkIn('opaque-token');
  assert.equal(result.coinTotal, null);
  assert.equal(result.earned, null);
});

test('a refreshed token is delivered before a subsequent network failure', async () => {
  const oldToken = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.x`;
  const newToken = 'replacement-token-with-enough-length';
  let saved = null;
  const client = new AkileClient({ fetchImpl: async url => {
    if (url.endsWith('/refreshToken')) return jsonResponse({ status_code: 0, data: { token: newToken } });
    assert.equal(saved, newToken);
    throw new Error('temporary network failure');
  } });
  await assert.rejects(() => client.checkIn(oldToken, { onTokenRefreshed: token => { saved = token; } }));
  assert.equal(saved, newToken);
});
