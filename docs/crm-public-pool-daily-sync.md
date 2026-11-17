# 每日自动同步智仪公海到悟空 CRM

智仪系统继续作为询盘归属与状态的来源。此任务只处理 `owner_id` 为空且状态为 `NO_REPLY` 或 `PUBLIC_POOL` 的正式询盘，使用领导已配置的悟空 CRM 账号，将客户放进 CRM 公海。每次最多处理 50 条；成功后记录时间，重复执行不会再为同一询盘建档。失败写入操作日志与 `crm_syncs.crm_pool_last_error`，下次继续重试。

## 发布前

1. 备份 `/opt/inquirymanager/data/inquiries.db`，并确认领导在“悟空CRM配置”页填写了 CRM 地址及领导账号。保留原有 `AUTH_SECRET`，否则已加密的 CRM 密码可能无法解密。
2. 在发布服务器 `/opt/inquirymanager/.env.local` 追加独立密钥 `CRM_POOL_SYNC_SECRET`，值建议用 `openssl rand -hex 32` 生成。不要把密钥提交到 Git。
3. 更新并重启智仪系统。先在服务器本机执行未授权检查，期望 HTTP 401；HTTP 503 表示密钥未被进程读取：

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4001/api/jobs/crm-public-pool
   ```

## 先手工测试

在发布服务器创建仅 root 可读的 `/etc/crm-pool-sync.curl`，内容只有一行（将占位符换为同一个密钥）：

```text
header = "Authorization: Bearer 你的同一个密钥"
```

执行 `chmod 600 /etc/crm-pool-sync.curl`。随后试运行：

```bash
curl --fail-with-body --silent --show-error --max-time 1800 --config /etc/crm-pool-sync.curl -X POST http://127.0.0.1:4001/api/jobs/crm-public-pool
```

响应示例：`{"attempted":3,"synced":3,"failed":0,"remaining":0}`。首次运行会处理现有公海询盘，请先在领导工作台核对待同步数量和 CRM 配置，确定要处理这些历史记录后再执行。

## 每日定时

在发布服务器使用 `crontab -e` 增加一行。下面是服务器本地时间每天 02:00；先用 `timedatectl` 确认时区为 `Asia/Shanghai`，否则按服务器实际时区换算。

```cron
0 2 * * * /usr/bin/flock -n /tmp/crm-public-pool-sync.lock /usr/bin/curl --fail-with-body --silent --show-error --max-time 1800 --config /etc/crm-pool-sync.curl -X POST http://127.0.0.1:4001/api/jobs/crm-public-pool >> /var/log/crm-public-pool-sync.log 2>&1
```

`flock` 防止同一服务器的两轮任务重叠；接口也会拒绝同一进程内的并发运行。通过 `tail -n 20 /var/log/crm-public-pool-sync.log` 查看结果。任务不会在每次网页访问时自动运行，必须设置这条 cron。
