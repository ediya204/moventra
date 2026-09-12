# 开户审批与默认功能权限发布

日期：2026-09-13（香港）。用户明确授权生产发布，并确认“沿用现有后台账号和客户范围”授予审批权限。

## 已部署

- GitHub main：功能实现 `2570e38`；一次性审计授权命令 `2d86136f4629a2f9f7a8821833361655dcfea4fc`。
- Render API `moventra-api`：部署 `dep-daio9ip5efls73eb0ki0`，状态 live，对应 `2d86136`。
- 生产 PostgreSQL：003迁移任务 `job-daioaitg1s2s7384ssi0` succeeded，日志确认 database migrations applied。
- 现有范围授权：任务 `job-daioar3m8hqs73dlvcv0` succeeded，日志确认 new_grants=1；原子新增审批授权及审计。未替客户提交、审批或激活。
- 客户端 Worker `moventra-web`：`a29e13aa-9f2d-4d25-a778-255441edf20a`；https://moventra.me/portal 。
- 运营 Worker `moventra-admin`：`7f53bf22-b7ed-4ba7-baa5-08ba88a28395`；https://admin.moventra.me/onboarding 。保留既有生产登录邮箱白名单。

## 备份与迁移预演

Render export `dpg-daepg09t0dsc73b7q55g-a/2026-09-12T16:58Z`，438076 bytes。
SHA-256：`9c222e3348a6b993558cfc1a20db8910ab6cf5d6a89d42d4ab4c6d041618bb56`。
私有备份保存在本机 `~/.local/share/moventra/backups/2026-09-13-onboarding/`，未提交Git，未公开下载链接。

成功恢复到本地独立 PostgreSQL 数据库，核对原迁移1/2及记录数：users=3、customers=1、accounts=0、transactions=0。隔离恢复库执行003及授权预演成功，新增审批范围1条。生产执行通过Render内部任务，不开放数据库外部IP白名单。

## 本次验证

- 前端/网关61项自动化测试通过；两端TypeScript与生产构建通过。
- Go PostgreSQL race全套通过，新增授权范围、停用/混合身份排除、幂等、审计失败回滚测试；go vet通过。
- 客户端、后台线上HTML和入口JS与发布产物逐字节一致；ClientHome、OnboardingPage、OperationsPage等关键分包一致。
- 本地8898旧隔离夹具已换成此次客户端生产产物；HTML、入口和ClientHome分包与线上一致。预览通过同域代理读取生产API，需要真实登录，无模拟余额。
- 后端healthz/readyz正常；两端匿名身份和开户GET/POST拒绝401、跨端路径404、DELETE405，共10项边界核验。健康检查不等于持有人业务验收。
- 没有以真实客户身份执行审批闭环，没有真实渠道写操作或资金变动。

## 使用与边界

客户在“开户与功能权限”提交申请；已授权运营登录并完成MFA，在“开户审批”填写依据并“审批并开通全部功能”。状态变成approved/active后默认获得全部客户端功能资格，页面每15秒在可见时同步；暂停收回资格，恢复重新开放。

本批交付的是开户状态、审批与默认功能资格。充值、兑换、开卡、消息和工单等实际办理接口尚未接入，不能把入口开放说成真实业务已可执行。未接入功能明确显示办理接口尚未接入；资金仍无伪造余额或演示流水。

## 回退与本地工作区

旧客户端Worker版本 `824c4a74-8c33-4325-9ffb-835eb575b5e0`，旧后台 `95455dc6-0ff1-4d0e-89a1-d724ad17cb58`，旧Go `0d5158d90a6f050d54480020f15ddbaf7303a204`。可按故障范围回退应用；003为增量结构，不以删除审计/状态表回退应用，不改写已应用迁移。

共享主工作区仍有无关未提交修改，未覆盖或重置；完整实现保存在GitHub main及本机 `codex/onboarding-default-features` 分支。发布使用隔离目录 `/tmp/moventra-client-publish-20260913`。
