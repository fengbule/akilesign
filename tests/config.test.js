import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function environment(t, values) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('encoded deployment passwords preserve Compose interpolation characters', t => {
  const password = "my$strong#password'with\\characters";
  environment(t, {
    ADMIN_PASSWORD: undefined,
    ADMIN_PASSWORD_BASE64: Buffer.from(password).toString('base64'),
    SESSION_SECRET: 's'.repeat(64),
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    TZ: 'Asia/Shanghai'
  });
  assert.equal(loadConfig().adminPassword, password);
});

test('invalid schedule timezones fail before starting the service', t => {
  environment(t, { TZ: 'invalid/timezone' });
  assert.throws(() => loadConfig(), RangeError);
});
