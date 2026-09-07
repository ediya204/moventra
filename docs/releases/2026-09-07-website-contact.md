# 官网留言邮件转发（2026-09-07）

## 已实现与部署

官网需求表由本地 TXT 下载改为 POST `/api/contact`。固定收件人为 `info@moventra.me`，发件人为 `Moventra Website <website@mail.moventra.me>`，访客邮箱仅用于 Reply-To。Cloudflare Email Service 原生绑定发送纯文本及已转义 HTML；无邮件 API 密钥进入前端。没有附件、自动回复或任意收件人接口。

提交时禁止重复操作，失败保留输入，成功清空表单并显示确认。中英文隐私政策、服务条款及 Cookie 政策已同步说明邮件处理。邮件服务接受请求不等于最终收件箱送达；界面不保证即时回复。

仅部署客户端 Worker `moventra-web`：`02572561-3a98-4fc4-b9f7-4587299dadac`，域名 moventra.me / www.moventra.me / moventra.apexisnetworking.work。未部署运营端、Go API 或数据库。

## 防滥用及数据边界

- 同源 POST JSON；客户端站点专用，运营端拒绝此接口。
- 固定 Cloudflare 收件人及发件人绑定限制；校验邮箱、姓名、服务枚举、正文长度、16 KB 请求体上限和隐藏诱捕字段。
- Cloudflare rate limit：namespace 1001，每 IP 每 60 秒最多 3 次请求。该限流是边缘本地执行，不是全球精确配额，也不等于 CAPTCHA。
- 发送失败返回 503，不伪造成功；不自动重试不确定发送。没有持久化幂等记录，用户手动重试可能重复，邮箱处理应识别重复内容。
- 请求内容不写入应用日志或数据库；由邮件服务处理并保存在咨询邮箱。语言偏好存储沿用现有设置。

## 基础设施

启用发送子域名 `mail.moventra.me`，Cloudflare 自动建立该子域名的发信 DKIM、退信域 SPF/MX 和 DMARC，DNS 已解析。根域 `moventra.me` 的 MX 仍为 mx1.spacemail.com / mx2.spacemail.com，未改变现有邮箱收信配置。

## 本次验证

- `node --test deploy/cloudflare/gateway.test.mjs deploy/cloudflare/contact.test.mjs tests/frontend/admin-admission.test.mjs tests/frontend/session-state.test.mjs`：20 项通过。
- `pnpm check:boundaries`：137 个源文件通过。
- `pnpm build:client`：通过；Wrangler production dry-run 通过。
- 生产 POST 测试（CONTACT-20260907）返回 HTTP 202 `accepted`，邮件仅发往用户授权的 info@moventra.me。
- 浏览器检查中文新版按钮、字段和隐私告知；真实浏览器测试 CONTACT-UI-20260907 发往同一授权收件箱。
- 最终邮箱收件箱、垃圾邮件分类未直接读取，不将服务接受视为收件箱验证。

## 回滚

上一客户端 Worker 版本：`fc7a8138-3edc-4cab-aee5-4f99244100e8`。
执行 `node deploy/cloudflare/node_modules/wrangler/bin/wrangler.js rollback fc7a8138-3edc-4cab-aee5-4f99244100e8 --config deploy/cloudflare/wrangler.jsonc --env production` 可回退客户端代码及绑定；独立邮件子域配置保留，避免误改根域收信记录。
