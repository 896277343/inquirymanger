# SF6 询盘管理系统

面向公司内部局域网的询盘分配与状态追踪 MVP。

## 启动

```powershell
npm.cmd run dev
```

本机打开 `http://localhost:3000`。同一局域网的其他电脑使用 `http://本机局域网IP:3000`。

初始账号：

- 领导：`leader` / `admin123`
- 业务员：`jane`、`justin`、`angel`、`shana`、`clarence` / `123456`

正式投入使用前务必修改初始密码，并在 `.env.local` 中设置 `AUTH_SECRET`。

## 数据

SQLite 数据库保存在 `data/inquiries.db`。备份时需同时备份该文件；正式部署会增加自动备份脚本。
