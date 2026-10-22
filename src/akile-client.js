export class AkileApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AkileApiError';
    this.status = status;
  }
}

function successful(body) {
  return body && typeof body === 'object' && ['0', '200'].includes(String(body.status_code));
}

function messageOf(body) {
  return String(body?.status_msg || body?.message || 'AkileCloud returned an unknown error');
}

function apiStatus(body) {
  const code = Number(body?.status_code);
  return Number.isInteger(code) && code >= 400 && code <= 599 ? code : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean' ||
      !['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function jwtExpiry(token) {
  try {
    const payload = String(token).split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expiry = optionalNumber(claims.exp);
    return expiry !== null && expiry > 0 && expiry <= 8.64e12 ? expiry * 1000 : null;
  } catch {
    return null;
  }
}

export class AkileClient {
  constructor({ baseUrl = 'https://api.akile.ai/api', fetchImpl = fetch, timeoutMs = 35_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, token) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: token,
          'user-agent': 'AkileCheckinService/1.0'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new AkileApiError(`网络请求失败：${error.message}`);
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new AkileApiError(`AkileCloud 返回了无法解析的内容（HTTP ${response.status}）`, response.status);
    }
    if (!response.ok) throw new AkileApiError(`${messageOf(body)}（HTTP ${response.status}）`, response.status);
    return body;
  }

  async getProfile(token) {
    const body = await this.request('/v1/user/index', token);
    if (!successful(body)) throw new AkileApiError(messageOf(body), apiStatus(body));
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data) ||
        !['username', 'ak_coin', 'user_id', 'id'].some(field => Object.hasOwn(body.data, field))) {
      throw new AkileApiError('AkileCloud 返回的账号信息不完整');
    }
    if (body.data.username) return body.data;
    // The dashboard endpoint now returns statistics; identity lives in /user/info.
    const details = await this.request('/v1/user/info', token);
    if (!successful(details)) throw new AkileApiError(messageOf(details), apiStatus(details));
    if (!details.data || typeof details.data !== 'object' || !details.data.username) {
      throw new AkileApiError('AkileCloud 返回的账号信息不完整');
    }
    return { ...body.data, ...details.data };
  }

  async validateToken(token) {
    const profile = await this.getProfile(token);
    const expiry = jwtExpiry(token);
    return {
      username: String(profile.username || profile.user_name || ''),
      coinTotal: optionalNumber(profile.ak_coin),
      lastCheckinAt: Number(profile.last_checkin_time || 0) || null,
      tokenExpiresAt: expiry ? new Date(expiry).toISOString() : null
    };
  }

  async refreshIfNeeded(token, now = Date.now()) {
    const expiry = jwtExpiry(token);
    if (!expiry || expiry > now + 12 * 60 * 60 * 1000) return { token, refreshed: false };
    const body = await this.request('/v1/user/refreshToken', token);
    if (!successful(body) || !body?.data?.token) throw new AkileApiError(`令牌刷新失败：${messageOf(body)}`, apiStatus(body));
    return { token: String(body.data.token), refreshed: true };
  }

  async checkIn(originalToken, { onTokenRefreshed } = {}) {
    const refresh = await this.refreshIfNeeded(originalToken);
    const token = refresh.token;
    // Persist the replacement before another request can fail or invalidate the old token.
    if (refresh.refreshed && onTokenRefreshed) await onTokenRefreshed(token);
    let profile = null;
    try { profile = await this.getProfile(token); } catch { /* The check-in endpoint remains authoritative. */ }
    const before = optionalNumber(profile?.ak_coin);
    const body = await this.request('/v1/user/Checkin', token);
    const message = messageOf(body);

    if (successful(body)) {
      const total = optionalNumber(body.data);
      return {
        status: 'success',
        message: '签到成功',
        coinTotal: total,
        earned: total !== null && before !== null ? total - before : null,
        token,
        tokenRefreshed: refresh.refreshed
      };
    }

    if (/(already.*check|check.*already|already checked|已.*签到|签到.*已|已经签到)/i.test(message)) {
      return {
        status: 'already',
        message: message || '今日已经签到',
        coinTotal: before,
        earned: 0,
        token,
        tokenRefreshed: refresh.refreshed
      };
    }
    throw new AkileApiError(message, apiStatus(body));
  }
}
