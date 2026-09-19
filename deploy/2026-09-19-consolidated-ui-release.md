# 2026-09-19 会话改动统一发布

## 范围与授权

用户要求所有开发会话完成后同步 GitHub main、部署上线，随后明确不等待客户端后端联调检查。联调任务确认仅只读、不修改共享文件。财务 UI 已冻结；本批基于 main b77c222 汇总 66 个明确文件，源码提交 `63371c7957d5957b4e3ed33f33c0dcfa971536dc` 已正常推送 main。

包括财务工作台、余额/订单/费率/报表、资金记录抽屉、账户安全、开卡页面排版、卡片备注、消费记录与近30天商户展示。各流程卡见[财务工作台](../docs/frontend/finance-workspace.md)、[卡片备注](../docs/business/customer-card-binding.md)、[账户安全](../docs/business/two-role-login.md)、[开卡](../docs/business/client-card-issuing.md)、[资金记录](../docs/business/fund-records.md)。真实发卡验收不由代码发布替代。

## 本次验证

209项前端/网关回归、两端类型检查与构建、依赖边界、Go test/vet/build、隔离 PostgreSQL 全套 race、文档与 diff 检查通过。数据库角色迁移测试的版本数量断言从22更新为23，修复后全套重跑通过。真实 Firebase、外部 Blnk 与 browser fixture 四项环境测试跳过。财务任务报告桌面和390px合成浏览器验证通过，详见财务工作台专题；本发布任务没有重新执行真实登录资金操作。

## 023 备份恢复

新鲜生产备份任务 `job-dan0ndh42hec73cpa4tg`，2026-09-19 04:12 UTC，包含最新人工入账。加密导出后789个分片完整还原，密文及解密文件SHA-256均一致。

- 原始备份：`3deceba24a65aa81f681f7920dd98555c72d79b5b164b41aff81d5afd2cc18f6`
- 加密备份：`197b560dcb8699b1c7414e45a989060fa37e7e4341da7443f51c88927f928863`
- 本机私有备份目录：`~/.codex/backups/moventra/2026-09-19-card-remarks`，不提交仓库。
- 隔离恢复成功；执行限定 `api migrate-card-remarks` 两次均成功，97张原表逐表行数及排序内容摘要不变；新备注表0行。隔离数据库已删除。
- 023 checksum：`4d365e40e30c25063963d8137ad7906e156a21be2d30735f3de92e09ae50e904`。

## 平台结果（已完成）

- Cloudflare 后台：`f6f36411-8c24-4d2c-8e1a-770f9c0e50d5`。
- Cloudflare 客户端：`68d35182-7aea-4136-8101-429cebb0f249`。
- Render API：`dep-dan0oibm8hqs739k8km0`，live；本批源码63371c7。
- Render issuing-worker：`dep-dan0oiek1f9s73f0onug`，live；本批源码63371c7。
- 生产023于04:17:28 UTC成功执行，任务 `job-dan0pirm8hqs739kbvvg`。该任务的迁移后全表不变断言因并发读取新增审计而失败；并非迁移失败，没有重放迁移或回滚数据。
- 只读复核任务 `job-dan0purtqb8s73a5ler0` 确认023 checksum匹配、备注0行、原324条审计内容摘要完全一致；新增325为balances:read、326为read，均无订单关联。其他97项原表/视图摘要不变。人工订单仅1笔completed，开卡订单0。
- 客户端58个、后台80个assets文件逐字节匹配本地构建；两端/login按现有规则302跳转各自登录页后200。API healthz/readyz200，两端自身me无认证401，跨端me404。没有把这些HTTP结果称为真实登录业务验收。
- 发布后再次读取API/Worker环境变量，与发布前完整键值集合一致。

## 配置与回退

发布前已实时确认 API `MANUAL_FUNDS_ENABLED=true`、`MANUAL_FUNDS_REQUIRE_REVIEW=false`；消息查询/Worker开启，主动发送关闭；API与发卡Worker均为 `funds_wallet` + `prepare`。本批不更改这些开关、不重复处理原1000 USD订单、不调用真实扣款或发卡。真实开卡仍缺指定验收客户、BIN与金额上限和完整认证证据。

代码回退可恢复API旧部署bf05e56、Worker旧部署5a61a52；两端应使用各自之前平台版本。023是新增独立元数据表，旧代码可忽略，回退应用时保留数据；不向主库直接覆盖恢复，不删除已写备注。若需数据恢复，使用加密备份先隔离恢复并核对上线后增量，另行评估。

联调任务另报告PHP/SGD原币展示单位疑点，尚未在本发布任务复核；由该只读检查单独出具证据，不将其标为本批修复。

执行工具参考：[Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)。源码提交与后续文档提交分别记录，文档提交不改变已部署产物。
