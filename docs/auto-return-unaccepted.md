# 48 小时未接受询盘自动退回

业务员在本次分配后的 48 小时内未点击“接受询盘”，定时任务会将询盘退回“待分配”，清空原负责人及接受/提醒时间，保留之前的历史记录，并写入 `AUTO_RETURN` 操作日志。领导工作台“最近自动退回待分配”可看到提醒。已接受的询盘不会被此任务退回，仍按原进度提醒规则处理。

此任务与每日 CRM 公海同步不同：退回状态为 `UNASSIGNED`，不会自动进入 CRM 公海。

## 发布与预览

先部署最新程序；发布服务器上沿用 `/etc/crm-pool-sync.curl` 中的定时任务密钥。不要改变已有的 `AUTH_SECRET`。在发布服务器执行只读预览：

```bash
curl --fail-with-body --silent --show-error --config /etc/crm-pool-sync.curl -X POST 'http://127.0.0.1:4001/api/jobs/return-unfollowed?dryRun=1'
```

返回的 `wouldReturn` 是当前已超时、首次执行会被退回的历史询盘数。先在领导工作台核对这些超时记录；确认后才执行真正的任务。

## 手工执行与定时

确认预览结果后手工执行一次：

```bash
curl --fail-with-body --silent --show-error --config /etc/crm-pool-sync.curl -X POST http://127.0.0.1:4001/api/jobs/return-unfollowed
```

每次最多退回 100 条；响应包含 `checked` 和 `returned`。随后用 `crontab -e` 加入每 5 分钟一次的任务：

```cron
*/5 * * * * /usr/bin/flock -n /tmp/inquiry-auto-return.lock /usr/bin/curl --fail-with-body --silent --show-error --max-time 60 --config /etc/crm-pool-sync.curl -X POST http://127.0.0.1:4001/api/jobs/return-unfollowed >> /var/log/inquiry-auto-return.log 2>&1
```

确认 `crontab -l` 已有此行，`systemctl is-active cron` 返回 `active`。任务约在分配后 48 小时至 48 小时 5 分钟内运行。使用 `tail -n 20 /var/log/inquiry-auto-return.log` 查看结果。不要把密钥写入 cron 或日志。
