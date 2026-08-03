#!/usr/bin/env sh
set -eu

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "请先安装 Docker Engine 和 Docker Compose 插件。"
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "缺少 openssl，请先安装。"
  exit 1
fi

printf '访问地址（推荐填已解析到本机的域名；临时测试可填 http://服务器IP）：'
read -r domain
if [ -z "$domain" ]; then echo "访问地址不能为空"; exit 1; fi

printf '设置管理面板密码（至少 12 位）：'
stty -echo
read -r admin_password
stty echo
printf '\n'
if [ "${#admin_password}" -lt 12 ]; then echo "密码少于 12 位"; exit 1; fi

secure_cookie=true
case "$domain" in http://*) secure_cookie=false ;; esac

umask 077
{
  printf 'DOMAIN=%s\n' "$domain"
  printf 'ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'CHECKIN_TIME=09:10\nTZ=Asia/Shanghai\nSESSION_HOURS=24\n'
  printf 'SECURE_COOKIE=%s\nPORT=3000\nDATA_DIR=/app/data\n' "$secure_cookie"
} > .env
mkdir -p data
chmod 700 data
docker compose up -d --build
docker compose ps
echo "部署完成：$domain"
