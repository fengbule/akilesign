# AkileCloud VPS 自动签到服务

一个面向自有或已授权账号的自托管签到面板。支持账号绑定、加密令牌存储、每天自动签到、手动执行、失败重试、状态与日志查看。

## 已实现

- 外部 Web UI，管理密码和登录限速保护
- 多个已授权账号独立启停、手动签到、登录状态检查和更新令牌
- 展示用户名、AK币余额、登录是否有效、令牌到期时间、上次验证与签到结果
- AES-256-GCM 加密保存 `akile-token`，网页及日志不回显令牌
- 默认每天 09:10（Asia/Shanghai）执行；失败最多重试 3 次，间隔至少 15 分钟
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

## 运维命令

```bash
docker compose ps
docker compose logs -f app
docker compose restart
docker compose pull && docker compose up -d --build
```

备份 `data/akile-checkin.sqlite` 和 `.env`。两者缺一不可：数据库保存密文，`.env` 中的 `TOKEN_ENCRYPTION_KEY` 用于解密。请把备份放在安全位置。

## 验证方式

- 当天已手动签到：点“立即签到”，状态显示“今日已签”即代表令牌、网络和接口链路正常。
- 尚未签到：状态显示“签到成功”，并记录获得的 AK 币数量与新余额。
- 次日：等待 09:10 后在“最近运行记录”确认定时任务结果。

2026-08-03 已使用一次性隔离账号完成真实端到端验证：账号绑定成功，首次签到获得 10 AK币、余额变为 10；紧接着第二次调用被正确识别为“今日已经签到”，余额保持 10。一次性邮箱随后已删除，测试凭证未保存。

官网签到接口并非公开、稳定的开发者 API。官网更改接口或引入验证码后服务可能失效，应停止重复请求并升级程序。
