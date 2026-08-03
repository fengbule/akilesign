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
      ? jsonResponse({ status_code: 0, data: { ak_coin: 88 } })
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
