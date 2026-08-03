export class AkileApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AkileApiError';
    this.status = status;
  }
}

function successful(body) {
  if (!body || typeof body !== 'object' || body.status_code === undefined) return true;
  return ['0', '200'].includes(String(body.status_code));
}

function messageOf(body) {
  return String(body?.status_msg || body?.message || 'AkileCloud returned an unknown error');
}

export function jwtExpiry(token) {
  try {
    const payload = String(token).split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(Number(claims.exp)) ? Number(claims.exp) * 1000 : null;
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
    if (!successful(body)) throw new AkileApiError(messageOf(body));
    return body.data || {};
  }

  async validateToken(token) {
    const profile = await this.getProfile(token);
    const expiry = jwtExpiry(token);
    return {
      username: String(profile.username || ''),
      coinTotal: Number.isFinite(Number(profile.ak_coin)) ? Number(profile.ak_coin) : null,
      lastCheckinAt: Number(profile.last_checkin_time || 0) || null,
      tokenExpiresAt: expiry ? new Date(expiry).toISOString() : null
    };
  }

  async refreshIfNeeded(token, now = Date.now()) {
    const expiry = jwtExpiry(token);
    if (!expiry || expiry > now + 12 * 60 * 60 * 1000) return { token, refreshed: false };
    const body = await this.request('/v1/user/refreshToken', token);
    if (!successful(body) || !body?.data?.token) throw new AkileApiError(`令牌刷新失败：${messageOf(body)}`);
    return { token: String(body.data.token), refreshed: true };
  }

  async checkIn(originalToken) {
    const refresh = await this.refreshIfNeeded(originalToken);
    const token = refresh.token;
    let profile = null;
    try { profile = await this.getProfile(token); } catch { /* The check-in endpoint remains authoritative. */ }
    const before = Number.isFinite(Number(profile?.ak_coin)) ? Number(profile.ak_coin) : null;
    const body = await this.request('/v1/user/Checkin', token);
    const message = messageOf(body);

    if (successful(body)) {
      const total = Number.isFinite(Number(body.data)) ? Number(body.data) : null;
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
    throw new AkileApiError(message);
  }
}
