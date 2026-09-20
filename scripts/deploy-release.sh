#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${1:-/opt/inquirymanager}"
ARCHIVE="${2:-/opt/inquirymanager-release.tar.gz}"
BACKUP_ROOT="/opt/backups/inquiry-manager"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

if [[ "$APP_DIR" != "/opt/inquirymanager" ]]; then
  echo "拒绝执行：应用目录必须是 /opt/inquirymanager"
  exit 1
fi

if [[ ! -s "$ARCHIVE" ]]; then
  echo "发布包不存在或为空：$ARCHIVE"
  exit 1
fi

mkdir -p "$APP_DIR" "$BACKUP_DIR"

if [[ -d "$APP_DIR/data" ]]; then
  cp -a "$APP_DIR/data" "$BACKUP_DIR/data"
fi
if [[ -f "$APP_DIR/.env.local" ]]; then
  cp -a "$APP_DIR/.env.local" "$BACKUP_DIR/.env.local"
fi

echo "数据库和环境配置已备份到：$BACKUP_DIR"
pm2 stop inquiry-manager >/dev/null 2>&1 || true
tar -xzf "$ARCHIVE" -C "$APP_DIR"

if [[ ! -f "$APP_DIR/server.js" ]]; then
  echo "发布失败：压缩包中没有 server.js"
  exit 1
fi

mkdir -p "$APP_DIR/data"
if [[ ! -f "$APP_DIR/.env.local" ]]; then
  printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 48)" > "$APP_DIR/.env.local"
  chmod 600 "$APP_DIR/.env.local"
  echo "已创建新的 .env.local"
fi

cd "$APP_DIR"
if pm2 describe inquiry-manager >/dev/null 2>&1; then
  PORT=4001 HOSTNAME=0.0.0.0 pm2 restart inquiry-manager --update-env
else
  PORT=4001 HOSTNAME=0.0.0.0 pm2 start server.js --name inquiry-manager
fi

sleep 3
curl -fsS -o /dev/null http://127.0.0.1:4001/login
pm2 save
echo "发布完成：智仪询盘管理系统已在 4001 端口运行"

