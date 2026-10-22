const $ = selector => document.querySelector(selector);
const state = { accounts: [], status: null };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'akile-ui', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  return data;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${error ? 'is-error' : ''}`;
  setTimeout(() => node.classList.add('hidden'), 3200);
}

function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

function showApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
}

function formatTime(value) {
  if (!value) return '尚未运行';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: state.status?.timezone || 'Asia/Shanghai'
  }).format(new Date(value));
}

function statusLabel(status) {
  return ({ success: '签到成功', already: '今日已签', error: '运行失败', running: '运行中', ready: '等待执行', new: '新绑定' })[status] || status;
}

function authLabel(status) {
  return ({ valid: '登录有效', invalid: '登录失效', unknown: '待验证' })[status] || '待验证';
}

function renderAccounts() {
  const list = $('#accountList');
  $('#accountCount').textContent = state.accounts.length;
  $('#validCount').textContent = state.accounts.filter(a => a.authStatus === 'valid').length;
  $('#successCount').textContent = state.accounts.filter(a => a.lastSuccessAt &&
    new Intl.DateTimeFormat('en-CA', { timeZone: state.status.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(a.lastSuccessAt)) === state.status.currentDate).length;
  $('#errorCount').textContent = state.accounts.filter(a => a.status === 'error').length;
  if (!state.accounts.length) {
    list.innerHTML = '<div class="empty">还没有账号。请在上方粘贴账号的 akile-token。</div>';
    return;
  }
  list.innerHTML = state.accounts.map(account => `
    <article class="account-card" data-id="${account.id}">
      <div class="account-main">
        <span class="status-dot is-${account.status}"></span>
        <div><h3>${escapeHtml(account.label)}</h3><p>${escapeHtml(account.username || (account.authStatus === 'valid' ? '已验证账号' : '待验证账号'))} · ${account.coinTotal ?? '—'} AK币</p><div class="auth-line"><span class="auth-tag is-${account.authStatus}">${authLabel(account.authStatus)}</span><small>上次验证：${formatTime(account.lastValidatedAt)}</small></div></div>
      </div>
      <div class="account-result"><span class="status-tag is-${account.status}">${statusLabel(account.status)}</span><p>${escapeHtml(account.lastMessage || '等待首次运行')}</p><small>上次签到：${formatTime(account.lastRunAt)}</small><small>令牌到期：${formatTime(account.tokenExpiresAt)}</small></div>
      <div class="account-actions">
        <button data-action="run" class="primary small" ${account.status === 'running' ? 'disabled' : ''}>立即签到</button>
        <button data-action="verify" class="ghost small">检查登录</button>
        <button data-action="toggle" class="ghost small">${account.enabled ? '暂停自动' : '恢复自动'}</button>
        <button data-action="token" class="ghost small">更新令牌</button>
        <button data-action="delete" class="danger small">删除</button>
      </div>
    </article>`).join('');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderLogs(logs) {
  const list = $('#logList');
  if (!logs.length) return void (list.innerHTML = '<div class="empty">暂无运行记录</div>');
  list.innerHTML = logs.map(log => `
    <div class="log-row"><span class="log-icon is-${log.level}"></span><div><strong>${escapeHtml(log.label || '系统')}</strong><p>${escapeHtml(log.message)}</p></div><time>${formatTime(log.createdAt)}</time></div>
  `).join('');
}

async function loadData() {
  const [accountData, logData, status] = await Promise.all([api('/api/accounts'), api('/api/logs?limit=80'), api('/api/status')]);
  state.accounts = accountData.accounts;
  state.status = status;
  $('#scheduleBadge').textContent = `每天 ${status.checkinTime} · ${status.timezone}`;
  renderAccounts();
  renderLogs(logData.logs);
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    showApp();
    await loadData();
  } catch (error) { $('#loginError').textContent = error.message; }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  showLogin();
});

$('#refreshBtn').addEventListener('click', () => loadData().catch(error => toast(error.message, true)));

$('#addForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/api/accounts', { method: 'POST', body: JSON.stringify({ label: $('#label').value, token: $('#token').value }) });
    $('#addForm').reset();
    toast('账号验证成功，已经加密保存');
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$('#accountList').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('[data-id]');
  const id = Number(card.dataset.id);
  const account = state.accounts.find(item => item.id === id);
  button.disabled = true;
  try {
    if (button.dataset.action === 'run') {
      await api(`/api/accounts/${id}/run`, { method: 'POST', body: '{}' });
      toast('签到请求已经完成');
    } else if (button.dataset.action === 'verify') {
      await api(`/api/accounts/${id}/verify`, { method: 'POST', body: '{}' });
      toast('登录状态正常');
    } else if (button.dataset.action === 'toggle') {
      await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !account.enabled }) });
      toast(account.enabled ? '已暂停自动签到' : '已恢复自动签到');
    } else if (button.dataset.action === 'token') {
      const token = prompt('粘贴新的 akile-token（内容不会显示在账号列表中）');
      if (!token) return;
      await api(`/api/accounts/${id}/token`, { method: 'PUT', body: JSON.stringify({ token }) });
      toast('令牌已验证并更新');
    } else if (button.dataset.action === 'delete') {
      if (!confirm(`确定删除“${account.label}”吗？加密令牌和该账号日志会一并删除。`)) return;
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      toast('账号已删除');
    }
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

api('/api/session').then(async session => {
  if (!session.authenticated) return showLogin();
  showApp();
  await loadData();
}).catch(showLogin);
