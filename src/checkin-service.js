import { encryptToken, decryptToken } from './token-crypto.js';
import { publicAccount } from './database.js';

function isoNow() { return new Date().toISOString(); }

function localParts(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export class CheckinService {
  constructor({ db, client, encryptionKey, timezone, checkinTime }) {
    this.db = db;
    this.client = client;
    this.encryptionKey = encryptionKey;
    this.timezone = timezone;
    this.checkinTime = checkinTime;
    this.running = new Set();
  }

  log(accountId, level, event, message) {
    this.db.prepare('INSERT INTO logs(account_id, level, event, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, level, event, String(message).slice(0, 1000), isoNow());
  }

  listAccounts() {
    return this.db.prepare('SELECT * FROM accounts ORDER BY id DESC').all().map(publicAccount);
  }

  getAccount(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  async addAccount(label, token) {
    const cleanLabel = String(label || '').trim().slice(0, 80);
    const cleanToken = String(token || '').trim();
    if (!cleanLabel) throw new Error('请输入账号备注');
    if (cleanToken.length < 20) throw new Error('令牌格式不正确');
    const profile = await this.client.validateToken(cleanToken);
    const encrypted = encryptToken(cleanToken, this.encryptionKey);
    const now = isoNow();
    const result = this.db.prepare(`
      INSERT INTO accounts(label, username, token_ciphertext, token_iv, token_tag, coin_total, auth_status, token_expires_at, last_validated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'valid', ?, ?, ?, ?)
    `).run(cleanLabel, profile.username, encrypted.ciphertext, encrypted.iv, encrypted.tag, profile.coinTotal, profile.tokenExpiresAt || null, now, now, now);
    this.log(Number(result.lastInsertRowid), 'info', 'account_added', '账号绑定成功，令牌已加密保存');
    return publicAccount(this.getAccount(Number(result.lastInsertRowid)));
  }

  async replaceToken(id, token) {
    const account = this.getAccount(id);
    if (!account) throw new Error('账号不存在');
    const cleanToken = String(token || '').trim();
    const profile = await this.client.validateToken(cleanToken);
    const encrypted = encryptToken(cleanToken, this.encryptionKey);
    const now = isoNow();
    this.db.prepare(`UPDATE accounts SET username=?, token_ciphertext=?, token_iv=?, token_tag=?, coin_total=?, auth_status='valid', token_expires_at=?, last_validated_at=?, status='ready', last_message='', updated_at=? WHERE id=?`)
      .run(profile.username, encrypted.ciphertext, encrypted.iv, encrypted.tag, profile.coinTotal, profile.tokenExpiresAt || null, now, now, id);
    this.log(id, 'info', 'token_updated', '登录令牌已验证并更新');
    return publicAccount(this.getAccount(id));
  }

  setEnabled(id, enabled) {
    const result = this.db.prepare('UPDATE accounts SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, isoNow(), id);
    if (!result.changes) throw new Error('账号不存在');
    this.log(id, 'info', enabled ? 'account_enabled' : 'account_disabled', enabled ? '已启用自动签到' : '已暂停自动签到');
    return publicAccount(this.getAccount(id));
  }

  deleteAccount(id) {
    const result = this.db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    if (!result.changes) throw new Error('账号不存在');
  }

  listLogs(limit = 100) {
    return this.db.prepare(`
      SELECT logs.id, logs.account_id AS accountId, accounts.label, logs.level, logs.event, logs.message, logs.created_at AS createdAt
      FROM logs LEFT JOIN accounts ON accounts.id = logs.account_id
      ORDER BY logs.id DESC LIMIT ?
    `).all(Math.min(500, Math.max(1, Number(limit) || 100)));
  }

  async verifyAccount(id) {
    id = Number(id);
    const account = this.getAccount(id);
    if (!account) throw new Error('账号不存在');
    try {
      const token = decryptToken(account, this.encryptionKey);
      const profile = await this.client.validateToken(token);
      const now = isoNow();
      this.db.prepare(`UPDATE accounts SET username=?, coin_total=COALESCE(?, coin_total), auth_status='valid', token_expires_at=?, last_validated_at=?, last_message='登录状态正常', updated_at=? WHERE id=?`)
        .run(profile.username, profile.coinTotal, profile.tokenExpiresAt || null, now, now, id);
      this.log(id, 'success', 'auth_valid', '登录令牌验证成功');
      return publicAccount(this.getAccount(id));
    } catch (error) {
      const now = isoNow();
      const invalid = Number(error.status) === 401;
      this.db.prepare(`UPDATE accounts SET auth_status=?, last_validated_at=?, last_message=?, updated_at=? WHERE id=?`)
        .run(invalid ? 'invalid' : 'unknown', now, String(error.message || error).slice(0, 500), now, id);
      this.log(id, 'error', invalid ? 'auth_invalid' : 'auth_check_failed', invalid ? '登录令牌已失效，需要更新' : `登录检查失败：${error.message}`);
      throw error;
    }
  }

  async runAccount(id, trigger = 'manual') {
    id = Number(id);
    if (this.running.has(id)) throw new Error('该账号正在签到，请稍候');
    const account = this.getAccount(id);
    if (!account) throw new Error('账号不存在');
    this.running.add(id);
    const now = isoNow();
    const local = localParts(this.timezone);
    const nextCount = account.attempt_date === local.date ? Number(account.attempt_count) + 1 : 1;
    this.db.prepare(`UPDATE accounts SET status='running', last_message=?, last_run_at=?, last_attempt_at=?, attempt_date=?, attempt_count=?, updated_at=? WHERE id=?`)
      .run(trigger === 'manual' ? '正在手动签到' : '正在自动签到', now, now, local.date, nextCount, now, id);
    this.log(id, 'info', 'checkin_started', trigger === 'manual' ? '开始手动签到' : '开始定时签到');

    try {
      const token = decryptToken(account, this.encryptionKey);
      const result = await this.client.checkIn(token);
      let tokenFields = null;
      if (result.tokenRefreshed) tokenFields = encryptToken(result.token, this.encryptionKey);
      const message = result.status === 'success'
        ? `签到成功${result.earned === null ? '' : `，获得 ${result.earned} AK币`}`
        : '今日已经签到';
      if (tokenFields) {
        this.db.prepare(`UPDATE accounts SET token_ciphertext=?, token_iv=?, token_tag=?, status=?, auth_status='valid', last_message=?, coin_total=COALESCE(?, coin_total), last_success_at=?, last_validated_at=?, updated_at=? WHERE id=?`)
          .run(tokenFields.ciphertext, tokenFields.iv, tokenFields.tag, result.status, message, result.coinTotal, isoNow(), isoNow(), isoNow(), id);
      } else {
        this.db.prepare(`UPDATE accounts SET status=?, auth_status='valid', last_message=?, coin_total=COALESCE(?, coin_total), last_success_at=?, last_validated_at=?, updated_at=? WHERE id=?`)
          .run(result.status, message, result.coinTotal, isoNow(), isoNow(), isoNow(), id);
      }
      this.log(id, 'success', result.status === 'success' ? 'checkin_success' : 'checkin_already', message);
      return publicAccount(this.getAccount(id));
    } catch (error) {
      const message = String(error.message || error).slice(0, 500);
      const authStatus = Number(error.status) === 401 ? 'invalid' : account.auth_status;
      this.db.prepare(`UPDATE accounts SET status='error', auth_status=?, last_message=?, updated_at=? WHERE id=?`).run(authStatus, message, isoNow(), id);
      this.log(id, 'error', 'checkin_failed', message);
      throw error;
    } finally {
      this.running.delete(id);
    }
  }

  async runDueAccounts(now = new Date()) {
    const local = localParts(this.timezone, now);
    if (local.time < this.checkinTime) return [];
    const accounts = this.db.prepare('SELECT * FROM accounts WHERE enabled=1 ORDER BY id').all();
    const due = accounts.filter(account => {
      if (account.attempt_date !== local.date) return true;
      if (Number(account.attempt_count) >= 3) return false;
      if (!account.last_attempt_at) return true;
      return now.getTime() - new Date(account.last_attempt_at).getTime() >= 15 * 60 * 1000;
    });
    return Promise.allSettled(due.map(account => this.runAccount(account.id, 'schedule')));
  }
}

export { localParts };
