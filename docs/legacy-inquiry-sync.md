# 旧留言系统接入智仪询盘管理

这份接入不修改网站表单或旧系统的 `updata.php`。旧系统照常保存到 SQLite；独立定时脚本只读取 `type='inquiry'` 的正常留言并传给智仪系统，`type='trashed'` 的垃圾留言留在旧库。通常在一分钟内同步。

## 发布前准备

1. 分别备份旧系统 SQLite 数据库和智仪系统的 `data/inquiries.db`。
2. 在旧系统当前数据库中读取最大留言 ID，作为上线分界线：

   ```bash
   sqlite3 '/实际路径/content/#inquiry_system.sqlite.php' 'SELECT COALESCE(MAX(id),0) FROM wp_inquiry;'
   ```

   例如得到 `2324`，则以下 `LEGACY_INQUIRY_SYNC_FROM_ID` 设为 `2324`。上线前的历史记录不会自动同步。
3. 生成一段至少 32 字符的随机密钥，并分别设置在两台服务器的环境变量 `LEGACY_INQUIRY_SYNC_SECRET`。不要提交到 Git。
4. 智仪系统进程设置 `LEGACY_INQUIRY_SYNC_SECRET` 后重启。接收地址为 `https://智仪系统域名/api/integrations/legacy-inquiry`。
5. 为旧系统的定时任务设置以下环境变量（不需要修改 PHP-FPM 环境）：

   ```text
   LEGACY_INQUIRY_SYNC_URL=https://智仪系统域名/api/integrations/legacy-inquiry
   LEGACY_INQUIRY_SYNC_SECRET=与智仪系统相同的随机密钥
   LEGACY_INQUIRY_SYNC_FROM_ID=上线前旧系统最大留言ID
   ```

   命令行还需设置 `LEGACY_INQUIRY_DB_PATH` 为旧 SQLite 数据库的绝对路径。密钥应放在仅管理员可读的配置文件中，不要写进公开网站目录或 Git。
6. 旧系统只需部署 `legacy-sync.php`；不要覆盖现有 `updata.php`、`includes/lib/function.base.php`、`defines.php` 或 SQLite 数据库。

## 定时重试

每分钟执行一次（示例，环境变量由仅管理员可读的配置文件提供）：

```bash
set -a; . /etc/legacy-inquiry-sync.env; set +a; php /旧系统绝对路径/legacy-sync.php
```

脚本每次处理最多 50 条未同步的正常留言，已成功同步的不会再传。失败原因保存在旧库 `wp_central_sync.last_error`。中央接口按旧留言 ID 去重，重复发送返回成功，不会新增第二条。

## 验收

1. 用测试网站提交一条正常留言，确认旧系统先保存，并在领导账号的“网站留言待审核”出现。
2. 重跑同步脚本，确认中央系统仍只有一条。
3. 在旧系统标记一条测试留言为 `trashed`，确认它没有进入中央系统。
4. 临时断开智仪系统，用测试留言确认旧系统仍能保存；恢复后运行重试脚本，确认补入待审核箱。
5. 在待审核箱填写邮箱、产品分类和营销来源，点击“确认录入”，再到“询盘管理”中分配。

`from_company` 是网站/品牌标识，`website` 是提交页面；这两个值与“谷歌广告/自然流量/在线聊天”的营销来源分开保存。旧系统没有可靠的营销来源字段，因此领导确认录入时选择。
