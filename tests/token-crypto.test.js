import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptToken, decryptToken } from '../src/token-crypto.js';

test('tokens are encrypted with authenticated encryption', () => {
  const key = crypto.randomBytes(32);
  const token = 'a-sensitive-akile-token-value';
  const encrypted = encryptToken(token, key);
  assert.equal(encrypted.ciphertext.includes(token), false);
  assert.equal(decryptToken({
    token_ciphertext: encrypted.ciphertext,
    token_iv: encrypted.iv,
    token_tag: encrypted.tag
  }, key), token);
});

test('tampered ciphertext is rejected', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptToken('secret-token', key);
  const bytes = Buffer.from(encrypted.ciphertext, 'base64');
  bytes[0] ^= 1;
  assert.throws(() => decryptToken({
    token_ciphertext: bytes.toString('base64'),
    token_iv: encrypted.iv,
    token_tag: encrypted.tag
  }, key));
});
