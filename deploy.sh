#!/usr/bin/env sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mode=${1:-}
case "$mode" in ''|--instabox) ;; *) echo '用法：./deploy.sh [--instabox]'; exit 1 ;; esac
if [ -z "$mode" ] && [ -f .env ] && grep -q '^DEPLOY_MODE=instabox$' .env; then mode=--instabox; fi
compose_file=docker-compose.yml
if [ "$mode" = --instabox ]; then compose_file=docker-compose.instabox.yml; fi
compose() { docker compose -f "$compose_file" "$@"; }

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "请先安装 Docker Engine 和 Docker Compose 插件。"
  exit 1
fi
if [ "$mode" = --instabox ] && ! command -v instabox-port >/dev/null 2>&1; then
  echo '--instabox 需要在 InstaBox 云主机中执行。'; exit 1
fi

temporary_env=''
saved_tty=''
cleanup() {
  if [ -n "$saved_tty" ]; then stty "$saved_tty"; fi
  if [ -n "$temporary_env" ]; then rm -f -- "$temporary_env"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -f .env ]; then
  echo '沿用已有 .env 和加密密钥，更新应用。'
else
  if [ -f data/akile-checkin.sqlite ]; then
    echo '已有账号数据库但缺少 .env。请先恢复配套配置备份，避免丢失解密密钥。'; exit 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then echo '缺少 openssl，请先安装。'; exit 1; fi
  domain=''
  if [ "$mode" != --instabox ]; then
    printf '访问地址（域名或临时 http://服务器IP）：'
    IFS= read -r domain
    if [ -z "$domain" ]; then echo '访问地址不能为空'; exit 1; fi
  fi
  printf '设置管理面板密码（至少 12 位）：'
  if [ -t 0 ]; then saved_tty=$(stty -g); stty -echo; fi
  IFS= read -r admin_password
  if [ -n "$saved_tty" ]; then stty "$saved_tty"; saved_tty=''; fi
  printf '\n'
  if [ "${#admin_password}" -lt 12 ]; then echo '密码少于 12 位'; exit 1; fi
  secure_cookie=true
  case "$domain" in http://*) secure_cookie=false ;; esac
  temporary_env=$(mktemp .env.XXXXXX)
  {
    printf 'DOMAIN=%s\n' "$domain"
    # Encoding avoids Compose interpolation of password characters; .env remains secret.
    printf 'ADMIN_PASSWORD_BASE64=%s\n' "$(printf '%s' "$admin_password" | openssl base64 -A)"
    printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
    printf 'CHECKIN_TIME=09:10\nTZ=Asia/Shanghai\nSESSION_HOURS=24\n'
    printf 'SECURE_COOKIE=%s\nPORT=3000\nDATA_DIR=/app/data\n' "$secure_cookie"
    if [ "$mode" = --instabox ]; then printf 'DEPLOY_MODE=instabox\n'; fi
  } > "$temporary_env"
  mv -- "$temporary_env" .env
  temporary_env=''
  unset admin_password
fi
chmod 600 .env
mkdir -p data
if [ "$mode" = --instabox ]; then
  instabox_url=$(instabox-port publish 3000 | tail -n 1)
  case "$instabox_url" in https://*) ;; *) echo '未能取得 InstaBox HTTPS 地址'; exit 1 ;; esac
  if ! grep -q '^PUBLIC_ORIGIN=' .env; then printf 'PUBLIC_ORIGIN=%s\n' "$instabox_url" >> .env; fi
fi
compose config --quiet
compose build app
# Let the image's non-root user access bind mounts even after a root deployment.
compose run --rm --no-deps --user 0 --entrypoint sh app -c 'chown -R node:node /app/data && chmod 700 /app/data'
compose up -d --wait --wait-timeout 120
compose ps
if [ "$mode" = --instabox ]; then
  printf '部署完成：%s\n' "$instabox_url"
else
  echo '部署完成，访问地址请查看 .env 中的 DOMAIN。'
fi
