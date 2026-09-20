#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/inquirymanger}"
DEPLOY_HOST="${DEPLOY_HOST:-root@43.135.134.204}"
REMOTE_ARCHIVE="/opt/inquirymanager-release.tar.gz"
ARCHIVE="$APP_DIR/inquirymanager-release.tar.gz"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Git项目不存在：$APP_DIR"
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "需要 Node.js 22，当前版本：$(node -v)"
  exit 1
fi

cd "$APP_DIR"
echo "1/6 拉取最新代码"
git pull --ff-only origin main

echo "2/6 安装锁定版本依赖"
npm ci

echo "3/6 编译 standalone 版本"
npm run build

echo "4/6 生成发布包"
rm -rf "$APP_DIR/release"
mkdir -p "$APP_DIR/release/.next"
cp -a "$APP_DIR/.next/standalone/." "$APP_DIR/release/"
cp -a "$APP_DIR/.next/static" "$APP_DIR/release/.next/static"
tar -czf "$ARCHIVE" -C "$APP_DIR/release" .
ls -lh "$ARCHIVE"
sha256sum "$ARCHIVE"

echo "5/6 上传到 $DEPLOY_HOST"
scp "$ARCHIVE" "$DEPLOY_HOST:$REMOTE_ARCHIVE"

echo "6/6 远程备份并更新发布服务器"
ssh "$DEPLOY_HOST" bash -s -- /opt/inquirymanager "$REMOTE_ARCHIVE" < "$APP_DIR/scripts/deploy-release.sh"

echo "全部完成"
