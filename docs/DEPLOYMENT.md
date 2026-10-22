# 完整部署与 AI 交接说明

本说明记录 2026-10-22 在 InstaBox 实际采用的部署方法，并提供普通 VPS、新装、更新和迁移的操作流程。公开文档不包含实际服务器地址、机器 ID、账号、管理密码或令牌。

## 1. 先判断任务类型

| 场景 | 需要的材料 | 密钥和账号处理 |
| --- | --- | --- |
| 全新安装 | 本仓库、目标机器访问权限、访问域名或 InstaBox 端口服务 | 生成独立管理密码和密钥，重新绑定授权账号 |
| 更新当前实例 | 已有代码目录、`.env`、`data/` | 保留原密码、加密密钥和数据库 |
| 迁移现有账号 | 本仓库、旧机器配套的 `.env` 与整个 `data/` 备份 | 保留原密钥，调整新地址和部署模式 |

只有 GitHub 源码时可以新装，无法还原旧账号和签到记录。不要使用网上示例密钥，也不要在数据库存在但配置缺失时生成新的加密密钥。

## 2. 运行结构与依赖

```text
普通 VPS：浏览器 HTTPS -> Caddy :443 -> Node 24 应用 :3000 -> AkileCloud API
InstaBox：浏览器 HTTPS -> InstaBox 端口转发 -> 127.0.0.1:3000 -> Node 24 应用
                                                   |
                                        .env + data/SQLite

可选：独立常驻 VPS -> 官方 wake API -> InstaBox 活动刷新
可选：Komari Agent -> 用户自己的监控面板
```

应用是单实例服务，使用 SQLite WAL 模式和 AES-256-GCM 保存账号令牌。不要让多个应用进程共同运行同一份数据库，也不要在迁移完成后同时保留新旧签到实例自动运行。

宿主机需要 Git、Docker Engine、Docker Compose 插件、OpenSSL，以及执行 Docker 的权限。Compose 需支持 `up --wait`。Docker 镜像自带 Node 24，宿主机的旧版 Node 不参与生产运行。

部署前确认：

```bash
git --version
docker version
docker compose version
docker info >/dev/null
openssl version
df -h .
ss -ltn
```

普通 VPS 检查 TCP 80、443 与回环地址 3000 是否冲突，域名 DNS 是否指向目标机器；使用 HTTP/3 时还需 UDP 443。InstaBox 检查回环地址 3000，并确认 `command -v instabox-port`。缺少依赖时按目标发行版的官方安装方法处理，不盲目套用别的系统命令。

## 3. 本次实际完成的部署过程

1. 在已授权的 InstaBox 上确认系统、Docker 权限和工作目录，项目最终放在 `/data/workspace/akilesign`。
2. 拉取源码并检查接口、调度、加密存储和部署脚本。修复官网资料接口变更、当天重复执行、错误状态、令牌刷新后的立即保存、数据目录权限和重新部署覆盖密钥等问题。
3. 通过受保护标准输入准备实例专用 `.env`，生成独立管理密码、会话密钥和令牌加密密钥，权限设为 600。自动化初始化没有把真实值写进脚本或 Git。
4. 执行 `sh deploy.sh --instabox`：发布 3000 端口、配置公开来源、构建 Node 24 镜像、修正数据目录所有权、启动容器并等待健康检查。
5. 公网代理会改写 Host，因而明确设置 `PUBLIC_ORIGIN` 为当前 HTTPS 面板地址，验证来源检查和安全 Cookie。
6. 在用户授权的浏览器中使用已有自动填充完成官网登录，取得相关站点当前有效的 `akile-token`，验证后绑定至面板。没有把官网密码复制进应用。
7. 验证真实签到、重复签到识别、真实令牌刷新与加密保存，以及重新部署后的配置和账号保留。
8. 在云端使用无头 Chromium 验证管理登录、页面刷新后的会话保留、账号检查、退出、桌面及手机布局。浏览器验收工具放在应用目录之外，没有加入生产依赖。
9. 运行 Node 24 下的全部测试及依赖审计；扫描源码与提交历史后推送 GitHub。实例配置、浏览器会话、数据库和验收截图均未发布。
10. 独立 VPS 上另有每 10 分钟刷新 InstaBox 活动的 systemd 定时任务；Komari 监控也是独立安装。它们不是 `deploy.sh` 自动附带的功能。

本次实测覆盖 InstaBox。下面的普通 VPS 和跨服务器迁移流程仍需在实际目标机器验收，不能将已有测试结果直接当作新机器的成功证明。

## 4. 全新部署

### 普通 VPS

以下以 `/opt/akilesign` 为例，使用有该目录写入权限且能执行 Docker 的用户：

```bash
cd /opt
git clone --branch main https://github.com/fengbule/akilesign.git
cd akilesign
sh deploy.sh
```

首次提示访问域名和至少 12 位管理密码。正式使用填自己的 HTTPS 域名，例如 `checkin.example.com`，不要照填示例地址。脚本生成 `.env`，启动应用与 Caddy，等待应用健康。

公网 HTTPS 验证成功后再绑定账号。`http://服务器IP` 只适合临时排障；通过 HTTP 访问时密码和令牌会明文传输。

### InstaBox

```bash
cd /data/workspace
git clone --branch main https://github.com/fengbule/akilesign.git
cd akilesign
sh deploy.sh --instabox
```

首次只提示管理密码。脚本调用 `instabox-port publish 3000`，保存其 HTTPS 地址为 `PUBLIC_ORIGIN`；应用只监听宿主机回环端口，由平台提供公网 HTTPS，不启动 Caddy。

如果目标目录已经存在，先检查 Git 状态和数据，按更新或迁移流程操作，不在已有目录上重复克隆。

### 自动化或 API 终端

没有交互终端时，可以通过受保护标准输入向脚本提供所需提示值，或先安全生成等价 `.env`；禁止把实际密码拼进命令参数。已有 `.env` 时脚本不会再次询问密码。

InstaBox 官方执行 API 的一次 HTTP 200 不等于 shell 成功，还要检查执行结果的 `exitCode`、`timedOut` 和 `stderr`。构建较慢时，在 `.env` 已准备完成后使用 systemd transient service 执行，并分别检查服务结果和容器健康；不要仅用 `nohup` 后台化就认定部署完成。

例如，在默认项目目录中、以有免交互 sudo 权限的部署用户执行：

```bash
deploy_unit="akilesign-deploy-$(date -u +%Y%m%d%H%M%S)"
deploy_user=$(id -un)
deploy_group=$(id -gn)
sudo -n systemd-run --unit="$deploy_unit" \
  -p "User=$deploy_user" -p "Group=$deploy_group" \
  -p "WorkingDirectory=$PWD" \
  /bin/sh -c 'exec sh deploy.sh --instabox > /data/workspace/akilesign-deploy.log 2>&1'
systemctl show "$deploy_unit.service" -p Result -p ExecMainStatus -p ActiveState
```

服务执行完后显示 `inactive` 可以是正常情况，需结合 `Result=success`、`ExecMainStatus=0` 与应用容器健康判断。该例需要 systemd；普通 SSH 终端也可以直接等待 `deploy.sh` 完成。

## 5. 配置含义与模式切换

| 配置 | 要求 |
| --- | --- |
| `ADMIN_PASSWORD_BASE64` | 脚本把管理密码编码保存，避免 Compose 展开特殊字符；这仍是秘密。兼容旧的 `ADMIN_PASSWORD` |
| `SESSION_SECRET` | 独立生成，例如 `openssl rand -hex 32`；更新时保留 |
| `TOKEN_ENCRYPTION_KEY` | 32 字节密钥，例如独立生成的 64 位十六进制值；迁移时必须与数据库配套 |
| `CHECKIN_TIME` / `TZ` | 默认 `09:10` / `Asia/Shanghai` |
| `PORT` / `DATA_DIR` | 标准 Compose 部署保持 `3000` / `/app/data` |
| `DOMAIN` | 普通 VPS 的实际域名或 Caddy 地址；InstaBox 可留空 |
| `PUBLIC_ORIGIN` | 浏览器实际访问的 `https://主机名`，不带路径；反向代理改写 Host 时尤其需要 |
| `SECURE_COOKIE` | 正式 HTTPS 保持 `true`；InstaBox Compose 会强制设为 `true` |
| `DEPLOY_MODE` | InstaBox 使用 `instabox`；切换到普通 VPS 时删除该项，避免无参数脚本继续选中 InstaBox 模式 |

不要直接照搬 `.env.example` 中的占位密码和密钥。不要通过 `source .env` 读取配置，也不要在公开输出中打印其内容。

跨机器或跨模式迁移时，先修改新地址对应的 `DOMAIN`、`PUBLIC_ORIGIN` 和 `DEPLOY_MODE`。新 InstaBox 实例可先执行 `instabox-port publish 3000` 取得地址，再更新已有 `.env`；脚本只在缺少 `PUBLIC_ORIGIN` 时追加，不会自动替换旧地址。

## 6. 绑定账号和真实验收

程序接收 `akile-token`，不保存 Akile 邮箱密码，也不实现密码自动登录。初次绑定或令牌彻底失效后，需要使用用户已授权的官网登录方式取得有效令牌。正常运行和有效令牌续期不依赖浏览器保持打开。

1. 在用户授权的浏览器登录官网 `https://akile.ai`；已有自动填充可正常使用，不必让用户把密码发到聊天里。
2. 从该站点 Local Storage 获取 `akile-token`，通过面板绑定。不要输出或提交浏览器存储、令牌值。
3. 检查用户名、余额、登录状态和令牌到期时间。已实测的官网接口中，`/v1/user/index` 返回统计，`/v1/user/info` 返回身份资料，程序会合并处理。
4. 先看当天记录。需要验证时执行一次“检查登录”和一次“立即签到”；成功或“今日已签”均是有效结果，不要为了展示反复请求。
5. 对照官网结果与面板日志，确认余额和状态合理；不要只根据 HTTP 200 判断业务成功。

接口自动验收需要先登录管理面板并保留 `akile_session` Cookie。修改请求携带 `X-Requested-With: akile-ui`，`Origin` 对应当前 `PUBLIC_ORIGIN`。密码、账号令牌和 Cookie 通过标准输入或受保护会话传递。

| 接口 | 用途 |
| --- | --- |
| `GET /healthz` | 公开进程健康检查，不能证明账号或签到成功 |
| `GET /api/session` | 检查管理面板会话 |
| `POST /api/login` | 管理密码登录，返回安全 Cookie |
| `GET /api/status` | 时区、计划时间、当前日期和账号数量 |
| `GET /api/accounts` / `GET /api/logs` | 需要管理登录；账号响应不包含令牌密文或明文 |
| `POST /api/accounts` | 使用 `label`、`token` 验证并绑定 |
| `POST /api/accounts/<id>/verify` | 检查已保存令牌 |
| `POST /api/accounts/<id>/run` | 单次真实签到 |
| `PUT /api/accounts/<id>/token` | 验证并保存新令牌 |

## 7. 测试、重启与验收标准

生产镜像只复制运行源码和静态文件，不包含测试目录。要测试完整仓库，可在项目根目录运行：

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$PWD:/workspace" -w /workspace node:24-bookworm-slim \
  sh -c 'npm ci --ignore-scripts && npm test && npm audit --omit=dev'
```

已有 Node 24 的开发环境也可以直接执行这些 npm 命令。2026-10-22 的基线是 20 项测试全部通过、依赖审计 0 已知漏洞；后续版本以实际输出为准。

以下以 InstaBox 为例；普通 VPS 将文件名改为 `docker-compose.yml`：

```bash
compose_file=docker-compose.instabox.yml
docker compose -f "$compose_file" config --quiet
docker compose -f "$compose_file" ps
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
docker compose -f "$compose_file" restart app
docker compose -f "$compose_file" up -d --wait --wait-timeout 120
```

重启前后比较账号、登录有效性和签到记录；确认 `.env` 的摘要未改变即可，不要打印密钥原文。更新脚本也应保留这些值。

交付前需实际确认：

- 容器健康，公网 HTTPS 可访问；未登录不能读取账号接口。
- 管理登录、页面刷新和退出正常；Cookie 使用 Secure、HttpOnly、SameSite=Strict。
- 授权账号有效，真实签到或“今日已签”有记录。
- 重启或重新部署后，账号、密钥和记录仍可用。
- 浏览器验收使用无头模式，桌面和手机视口无横向溢出、无页面脚本错误。
- 下一次实际计划时间后的记录单独观察；模拟时间测试不能证明次日真实任务已发生。

## 8. 更新现有实例

在当前项目目录检查 `git status --short`、分支和本地修改，先备份 `.env` 与数据。工作区有其他修改时先理解其用途，不用 `git reset --hard` 或 `git clean` 抹掉。

```bash
git fetch origin
git merge --ff-only origin/main
sh deploy.sh --instabox
```

普通 VPS 最后一行使用 `sh deploy.sh`。脚本不安装 Docker、不绑定 Akile 账号、不部署保活或监控；它会保留已有 `.env`、构建镜像、修正数据权限并等待应用健康。

## 9. 安全备份与跨服务器迁移

先确认旧实例的 Compose 文件。SQLite 使用 WAL，不能只在线复制主 `.sqlite` 文件而遗漏尚未归并的数据。下面是迁移用的停机备份例子：

```bash
umask 077
compose_file=docker-compose.instabox.yml
mkdir -p backups || exit 1
backup_file="$PWD/backups/akilesign-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose -f "$compose_file" stop app || exit 1
if ! tar -czf "$backup_file" .env data; then
  docker compose -f "$compose_file" start app
  exit 1
fi
chmod 600 "$backup_file"
```

此例在成功备份后保持旧应用停止，防止与新实例同时刷新令牌或签到。若只是日常备份，完成后执行 `docker compose -f "$compose_file" start app` 恢复。普通 VPS 按实际情况替换 Compose 文件名。

将备份通过已授权 SSH/SFTP 安全传到新机器。只恢复可信自有备份；先检查压缩包只含 `.env` 和 `data/`，没有绝对路径或父目录跳转。

在新克隆且尚未初始化的项目目录中恢复：

```bash
if [ -e .env ] || [ -e data ]; then
  printf '%s\n' '目标目录已有配置或数据，停止恢复。' >&2
  exit 1
fi
archive=/secure/path/akilesign-migration.tar.gz
tar -tzf "$archive" || exit 1
tar -xzf "$archive" --no-same-owner --no-same-permissions
chmod 600 .env
```

仅在确认目标目录没有 `.env` 或 `data/` 时继续恢复；不要覆盖已有实例。调整第 5 节中的地址与模式配置，保留密码和密钥，然后在新机器执行对应部署命令并完成验收。

旧实例和备份先保留作回退，新实例确认正常后再按用户要求处理。回退前先停止新实例；如果新实例已经刷新令牌，应将最新配套数据安全备份再恢复到旧端，旧备份中的令牌不一定仍然有效。

## 10. InstaBox 保活与监控的边界

本次运行环境还配置了外部常驻 VPS 的 `instabox-keepalive.timer`，每 10 分钟调用官方 wake API 刷新指定机器活动。服务名为 `instabox-keepalive.service`，应用本身没有安装它，仓库也没有附带该服务脚本及私人配置。

接手 AI 更换 InstaBox 实例或保活 VPS 时，需要单独根据用户授权配置当前 API Key 和机器 ID，按平台当前官方接口重新建立定时任务。API Key 放在受保护配置中，权限 600；不能复用文档示例、旧机器 ID 或其他人的配置。保活应在独立常驻机器运行，不能只放在会被暂停的 InstaBox 自身或用户浏览器里。

本次实测的官方请求形式如下，尖括号内容是占位符：

```http
POST https://api.instabox.sh/v1/machines/<MACHINE_ID>/wake
X-API-Key: <INSTABOX_API_KEY>
Content-Type: application/json

{}
```

使用标准输入或受保护配置构造请求，不把实际 Key 放进 curl 参数。确认响应成功后检查机器最终进入 `running`；唤醒可能需要异步等待。重建 timer 可采用 `OnCalendar=*:0/10` 和 `Persistent=true`，同时检查该机器上的 systemd 日历解析与下次触发时间。平台接口如有变化，先核对当前官方接口。

若已有同名服务，可检查：

```bash
systemctl show instabox-keepalive.timer -p ActiveState -p UnitFileState -p LastTriggerUSec
systemctl show instabox-keepalive.service -p Result -p ExecMainStatus
journalctl -u instabox-keepalive.service -n 10 --no-pager
```

需要确认 timer 已启用且活动、最近调用成功，并观察 InstaBox 活动实际刷新。换用普通常驻 VPS 部署签到服务时，不需要 InstaBox 保活。

Komari 也是独立 Agent；仅在用户要求监控时，使用其为目标机器授权的监控端点和安装令牌配置，确认服务与面板上线。不要把监控令牌写入本仓库。监控在线不能代替签到结果验收。

## 11. 调度行为与排障

- 应用启动约 3 秒后检查一次，随后每分钟扫描任务；默认北京时间 09:10 起执行。当天成功或已签后，自动任务不再重复请求官网。
- 临时错误至少间隔 15 分钟重试，每天自动最多 3 次。失败次数用尽后当天不再自动尝试；登录被判定失效后也会停止，需更新有效令牌恢复。
- 令牌剩余有效期不超过 12 小时时尝试官方刷新，并立即加密保存；彻底过期时不能保证刷新成功，也不会自动读取浏览器密码重新登录。
- 当天恢复运行后，符合调度条件的未完成任务可以补执行；整天离线或重试已耗尽可能漏签，不能补回官网不支持的往日签到。
- 当前应用只记录失败，没有签到失败推送。Docker 健康检查、VPS 保活和账号签到成功是三个不同状态。

| 现象 | 检查方向 |
| --- | --- |
| 登录返回来源验证失败 / 403 | 新地址与 `PUBLIC_ORIGIN`、请求 Origin、代理 Host 转发是否匹配 |
| 管理登录成功但下一次请求未登录 | 客户端是否保存并发送 Cookie；HTTP 是否误配 Secure Cookie；不要打印 Cookie 值 |
| 账号检查返回 502 | Akile 上游失败或令牌问题；该状态不应退出管理面板，查看脱敏错误信息 |
| 登录返回 401 | 管理密码错误或管理会话失效；区分 Akile 登录失效 |
| 返回 429 | 管理密码限速或平台代理限流，先降低请求频率，不要连续重试 |
| SQLite 权限错误 | 是否使用正确 Compose 文件和挂载路径；通过部署脚本修复容器数据目录权限，不删除数据库 |
| 有数据库但缺少 `.env` | 恢复匹配备份，不能生成新密钥覆盖 |
| 健康但未签到 | 自动开关、时区、计划时间、登录有效性、当天成功记录、重试次数、日志及主机停机情况 |

## 12. 交付给用户与后续 AI

交付记录应列出目标环境、部署模式、代码提交、访问地址、管理凭据的安全保存位置、备份位置、已完成验证和仍需观察的实际定时执行。公开 Git 提交只保留通用步骤和脱敏结果。

用户可以把下面这段任务交给接手 AI：

> 请拉取 fengbule/akilesign 的 main 分支，先阅读 AGENTS.md 和 docs/DEPLOYMENT.md，再检查我授权的目标服务器。根据现有 .env 和 data/ 判断新装、更新或迁移，保留已有数据和配套密钥，使用对应 Compose 模式部署。完成真实账号验证、必要的一次签到、重启和公网登录验收。凭据只通过安全渠道保存，不进入 GitHub 或公开输出；保活和监控按目标环境单独处理，说明实际已验证和待观察的部分。
