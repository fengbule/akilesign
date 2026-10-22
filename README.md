# AkileCloud VPS 自动签到服务

一个面向自有或已授权账号的自托管签到面板。支持账号绑定、加密令牌存储、每天自动签到、手动执行、失败重试、状态与日志查看。

## 已实现

- 外部 Web UI，管理密码和登录限速保护
- 多个已授权账号独立启停、手动签到、登录状态检查和更新令牌
- 展示用户名、AK币余额、登录是否有效、令牌到期时间、上次验证与签到结果
- AES-256-GCM 加密保存 `akile-token`，网页及日志不回显令牌
- 默认每天 09:10（Asia/Shanghai）执行；自动签到每天至多尝试 3 次，失败间隔至少 15 分钟，当天成功或已签后停止自动请求
- JWT 临近过期时调用官网刷新接口并重新加密保存
- SQLite 持久化、Docker 健康检查、Caddy 自动 HTTPS

本项目不提供账号注册、临时邮箱或奖励批量获取功能。

## 最简 VPS 部署

要求：一台已安装 Docker Engine 与 Docker Compose 插件的 Linux VPS。推荐准备一个域名，并把域名 A/AAAA 记录解析到 VPS。

```bash
cd akile-checkin-service
chmod +x deploy.sh
./deploy.sh
```

脚本会询问访问域名和面板管理密码，随后生成随机加密密钥并启动服务。域名模式下 Caddy 会自动申请 HTTPS 证书。临时测试可输入 `http://服务器IP`，但 HTTP 会以明文传输管理密码和账号令牌，只应短时使用；正式使用必须换成域名 HTTPS。

防火墙需开放 TCP 80、443；使用 HTTP/3 时可额外开放 UDP 443。

## 绑定账号

1. 在浏览器登录 <https://akile.ai/console>。
2. 按 F12，进入 **Application（应用）** → **Local storage** → `https://akile.ai`。
3. 复制 `akile-token` 的 Value。
4. 登录本面板，在“绑定已有账号”中填写备注和令牌。

面板会先调用用户信息接口验证令牌，验证通过后才加密入库。令牌相当于登录凭证，不要通过聊天工具发送给他人。

## InstaBox 部署

在 InstaBox 的 `/data/workspace` 克隆项目后执行：

```bash
cd /data/workspace/akilesign
sh deploy.sh --instabox
```

使用 `docker-compose.instabox.yml` 启动 Node 24 容器，数据保存在项目的 `data/`，通过 `instabox-port publish 3000` 获取 HTTPS 地址。此模式由 InstaBox 转发端口，不需要域名或 Caddy；云主机需保持运行。

脚本会将浏览器访问地址记录为 `PUBLIC_ORIGIN`，供来源检查使用。其他反向代理若改写 Host，也应设置这一项；迁移到新域名后需同步更新。

首次执行设置管理密码；再次执行会沿用 `.env`，保留管理密码、会话密钥和令牌加密密钥。部署脚本会修正容器数据目录的所有权，并等待健康检查通过。新配置使用 `ADMIN_PASSWORD_BASE64` 保留密码中的特殊字符；Base64 仅是编码，`.env` 仍必须保密，权限为 600。原来的 `ADMIN_PASSWORD` 配置继续有效。

```bash
docker compose -f docker-compose.instabox.yml ps
docker compose -f docker-compose.instabox.yml logs --tail 50 app
docker compose -f docker-compose.instabox.yml restart app
```

## 本次修复

- 适配官网当前接口：`/v1/user/index` 返回余额统计，`/v1/user/info` 返回用户名及上次签到时间。
- 当天成功不重复定时签到，临时错误按 15 分钟间隔重试；登录失效时停止自动请求，更新令牌后恢复。
- 刷新后的令牌立即加密落库并更新到期时间，即使后续签到网络失败也不会丢失新令牌。
- Akile 登录失效不会退出管理面板；空响应和不完整资料不会被当作有效登录，未知余额不会显示为零。
- “今日成功”和记录时间统一使用配置时区，避免浏览器所在时区影响显示。
- 重新部署保留密钥，修复 root 部署后容器无法访问数据目录的问题，并更新存在已知问题的依赖。

## 运维命令

```bash
docker compose ps
docker compose logs -f app
docker compose restart
docker compose pull && docker compose up -d --build
```

备份 `data/akile-checkin.sqlite` 和 `.env`。两者缺一不可：数据库保存密文，`.env` 中的 `TOKEN_ENCRYPTION_KEY` 用于解密。请把备份放在安全位置。

## 验证方式

2026-10-22 已在 InstaBox 的 Node 24 容器完成 20 项自动测试，并使用已授权账号验证真实签到、重复签到识别、令牌刷新与加密保存、重新部署后的数据保留。真实 Chromium 验证了 HTTPS 登录、刷新后会话保留、退出，以及桌面和手机布局。次日定时执行仍需等到实际计划时间观察。

- 当天已手动签到：点“立即签到”，状态显示“今日已签”即代表令牌、网络和接口链路正常。
- 尚未签到：状态显示“签到成功”，并记录获得的 AK 币数量与新余额。
- 次日：等待 09:10 后在“最近运行记录”确认定时任务结果。

2026-08-03 已使用一次性隔离账号完成真实端到端验证：账号绑定成功，首次签到获得 10 AK币、余额变为 10；紧接着第二次调用被正确识别为“今日已经签到”，余额保持 10。一次性邮箱随后已删除，测试凭证未保存。

官网签到接口并非公开、稳定的开发者 API。官网更改接口或引入验证码后服务可能失效，应停止重复请求并升级程序。
