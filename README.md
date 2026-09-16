# SF6 询盘管理系统

面向公司内部局域网的询盘分配与状态追踪 MVP。

## 启动

```powershell
npm.cmd run dev
```

本机打开 `http://localhost:4001`。同一局域网的其他电脑使用 `http://本机局域网IP:4001`。

初始账号：

- 领导：`leader` / `admin123`
- 业务员：`jane`、`justin`、`angel`、`shana`、`clarence` / `123456`

正式投入使用前务必修改初始密码，并在 `.env.local` 中设置 `AUTH_SECRET`。

## 数据

SQLite 数据库保存在 `data/inquiries.db`。备份时需同时备份该文件；正式部署会增加自动备份脚本。

## 在其他服务器构建后发布

建议构建机和发布服务器都使用 Linux x64，并安装相同大版本的 Node.js（要求 Node.js 22.5+，推荐 Node.js 22 LTS）。发布服务器不需要执行 `npm install` 或 `npm run build`。

在构建机执行：

```bash
git clone https://github.com/896277343/inquirymanger.git
cd inquirymanger
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
tar -C .next/standalone -czf ../../inquirymanager-release.tar.gz .
```

将 `inquirymanager-release.tar.gz` 上传到发布服务器，然后执行：

```bash
mkdir -p /opt/inquirymanager
tar -xzf inquirymanager-release.tar.gz -C /opt/inquirymanager
cd /opt/inquirymanager
mkdir -p data
printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 48)" > .env.local
PORT=4001 HOSTNAME=0.0.0.0 node server.js
```

使用 PM2 常驻运行：

```bash
cd /opt/inquirymanager
PORT=4001 HOSTNAME=0.0.0.0 pm2 start server.js --name inquiry-manager
pm2 save
```

以后更新时，在构建机重新生成压缩包。发布前保留服务器上的 `.env.local` 和 `data` 目录，解压覆盖程序文件后执行：

```bash
pm2 restart inquiry-manager --update-env
```
