# FLOW-WALLET-001：项目上游钱包与逐卡归属

本轮用户确认：APEXIS INC. → Cash account → APEXIS Op 是 Moventra 共用的上游钱包；当前已有卡片及其对应历史记录归 ediyanghk@gmail.com，后续用户的新卡显式归各自客户。钱包余额不等于任何单个客户余额。配置不会调用 Slash 开卡、转账、改名或调整余额接口。

## 基线与差异

基线 f45100a（独立工作树，保留原共享目录）。现行 007 只保存整批测试快照，不能直接当作按钱包隔离的客户归属。现有 260 张卡及 3818 笔交易属于历史整批测试授权，不证明全部来自 APEXIS Op。浏览器及 Render GET 已确认 virtual account ID `subaccount_3m3kfvgq9ftz5`，父 accountId `sa_group_37b7q8psnpwy8`，name=APEXIS Op，accountType=default。2026-09-18 03:22:43 UTC 按父账户及 virtualAccountId 查询到 23 张卡，metadata.count=23，nextCursor 缺省/null。仅证明本次列表响应覆盖；历史交易另行核验。

官方依据：[虚拟账户详情](https://docs.slash.com/api-reference/virtual-account-get-by-id)、[卡列表](https://docs.slash.com/api-reference/card-get)、[交易列表](https://docs.slash.com/api-reference/transaction-get)。外部对象保持 Slash 原类型；项目主钱包是内部用途，不把 Slash accountType 改成 primary。

## 完整流程与接口链

受信操作员取得脱敏来源投影 → 审阅指定连接/父账户/virtualAccountId/版本/固定卡 ID 清单 → 校验用户 Firebase 邮箱与 UID → plan 输出变更摘要 → apply 同事务保存项目钱包、逐卡归属和审计 → 客户端既有 card-projections 列表/卡详情/交易详情读取。后台仍需 staff + 独立连接授权 + MFA。

- 初次切换为指定用户启用钱包范围后，其旧整批快照不再参与客户查询，但原快照、归属记录与来源历史均保留。
- 新增卡必须提供明确的客户 UID 和固定卡 ID 清单。注册、来源同步及项目钱包配置不会将卡自动归给默认用户。
- 连接 + cardId 全局唯一归属；发现其他客户既有归属则拒绝，不改写历史。
- 卡和交易都必须明确匹配父账户和 virtualAccountId；历史缺字段、不同钱包、无 cardId 的账户级收支不得冒充客户记录。
- 已授权客户从当前导入版本读取其明确归属卡片，版本改变沿用 409 重读机制；同步新增其他卡不扩大权限。
- 项目钱包是渠道配置，客户内部资金/测试钱包、原交易金额及审批状态不变。真实开卡尚未接入，本次不把测试开卡当真实 Slash 开卡。

## 本轮范围和上线门槛

本地实现：增量迁移 011、投影 virtualAccountId 白名单、受控 plan/apply 命令、兼容查询与客户隔离测试。CLI 用显式来源版本和卡 ID 清单，禁止“以后所有卡归指定邮箱”的通配策略。已有项目钱包不允许静默切换，正式更换渠道另行迁移。

用户已批准以下线上步骤，执行结果逐项记录：核验当前 Render 的父账户及卡清单；有界采集并确认历史覆盖；备份/恢复验证；011 迁移和发布；对固定清单执行 plan/apply；用户登录检查列表、详情、刷新及跨用户拒绝。

验证重点：不同钱包/不同连接拒绝、旧快照访问收窄、新卡不自动归初始用户、新用户只看自己卡及对应交易、归属冲突全回滚、重复绑定幂等、版本变化可恢复、审计故障拒绝、金额精度及未知字段不伪造。设计、本地测试、渠道实证和部署分别记录。

## 本轮证据（2026-09-18）

- 工作分支 codex/apexis-project-wallet；代码基线 f45100a，发布前已合入 625d579 商户图标修复；保留原共享工作区。
- 本地随机 PostgreSQL 库：`bash services/api/scripts/test-postgres.sh`，race 模式 34 个顶层测试通过；真实 Blnk 与 Firebase 联调 2 项按环境要求跳过。
- `pnpm typecheck` 两端通过；`pnpm test` 96 项通过；`pnpm build:admin` 通过；Go vet/build 通过。无本轮已登录浏览器验收。
- Render 只读虚拟账户核验 job-damasj8u01pc73f03cd0 成功；实际 wallet/card 查询均为 GET，无 Slash 写接口。
- Render 卡清单 job-damasv6k1f9s73esmiu0：23 张；本机/MCP 请求仍不属于已放行出口。
- Render 既有只读 card-bindings-plan job-damat4dbedkc73an8q8g：目标 Firebase 身份核验成功，customerId=9970544c-6651-4b36-9231-07513b40d070；现有连接 slash-local-78d9b168487872448d9766ab；旧投影 260 卡/3818 关联交易。此命令未应用任何绑定。
- 初次交付时 011 未执行在线迁移，代码未部署，23 卡未写入新归属；后续已获用户批准，见下方发布准备证据。新卡真实创建尚未实现；已实现的是创建完成且来源已入库之后的显式逐卡分配。

- Render 历史只读汇总 job-damatne1egvs738pnv8g：父账户+virtualAccountId 筛选，两页100/68条，nextCursor耗尽。其中21+9=30条同时匹配固定23张卡、父账户和虚拟账户；另外138条不满足该组合，保留上游层不直接授权个人。返回记录日期区间2025-11-12至2026-09-16；分页耗尽不等于完整账单或全生命周期证明。
- 新增标准库只读导出工具 `services/api/scripts/collect-project-wallet.py`：stdin固定卡清单、stdout脱敏bundle+coverage；20页上限，每页4MiB/1000条，游标循环/卡清单变化拒绝；JSON Decimal/整数精确保留金额，PAN/CVV/账号/memo不输出。5项单元验证通过。首次准备阶段只保存卡清单及统计；批准后已实际导出并在恢复副本验证，见下方。

## 已批准的线上变更范围

1. 在当前线上main重新核对011编号及并行发布；备份并验证恢复。发布API及后台，执行增量011，不启用真实资金执行。
2. 以固定23卡清单对 `sa_group_37b7q8psnpwy8` / `subaccount_3m3kfvgq9ftz5` 有界采集。建议新建明确试运行来源连接 `slash-apexis-op-trial`，保留旧连接原始记录；卡清单变化或历史不完整则停止并重新审阅。只导入与固定卡、父账户、virtualAccountId匹配的来源，不将账户级其他记录强分个人。
3. import-channel之后记录实际revision，使用Firebase核验的目标邮箱和现有有权操作员运行project-wallet-plan。审阅卡数量、交易数量、旧授权范围和hash后apply；一事务保存项目钱包、逐卡归属、客户范围切换和审计。
4. 复核目标用户只显示这23卡及可关联历史，旧批次不再对其开放；新用户独立逐卡授权。验证失败撤回本次配置/版本需保留审计，不删除原来源或改写余额。

新卡申请的真实Slash执行通道尚未实现；项目配置和明确逐卡分配机制不能代替真实开卡。后续接入需从项目钱包配置解析accountId/virtualAccountId，并把确认创建的cardId绑定到申请customer，而不是初始测试邮箱。

## 获批后的发布准备证据

- 用户明确批准上述迁移、API/后台发布、固定清单导入及绑定。发布代码合入最新 main 625d579，未纳入并行 BIN 开发。
- 新加密备份：Render job-damb0gu1egvs738q12bg，custom dump 540839 字节，SHA-256 `48ec6bbbc8dedc33afcbe7fa90de30d82094a9bef57dc0edfadcb3326f13ed60`。加密副本 SHA-256 `88ad4a6d791cfd29de9b1219297ff3aa9dcf73201a0ffbebc757dda1c8edb8eb`。保存在仓库外受限私有目录；未开放数据库公网。
- 独立本地恢复成功；已安装版本 1–5、7–10 的 9 项 checksum 均与源码一致。本次仅新增 011，不补跑已有未启用的 006。
- 恢复副本执行 011 成功；用户、客户、成员、账户、交易、运营权限、连接和来源记录的逐表计数与内容校验值保持不变。
- 实际脱敏采集 job-damb1sdbedkc73annq60：23 卡、30 条关联交易、138 条不满足组合条件而排除，分页耗尽但不声明完整账单。导出 SHA-256 `f87fea45f996b319943fae643506432720a26a30bbdc4b939d0c7e91a6f5aa9f`。
- Slash 对 Python 默认 User-Agent 返回非 JSON 403；明确设置 `moventra-readonly-projection/1.0` 后 GET 成功。无密钥/来源原文写入共享日志。
- 恢复副本真实数据业务验证：导入并计划 23 卡/30 交易，旧范围 260 卡；显式 apply 后两个客户 API 列表返回对应数量，旧连接入口 404，共享账户字段不泄露。该验证使用仅本地测试身份替身，不是线上 Firebase 登录验收。
- 准备应用的来源 revision `a68b1c6addbb8fa7819e9bc769a43955daafda2b3361ff9d4b45013fb6d50701`，plan SHA-256 `c558b8ec02b6f45fd7edf15c055aa8e0edb236edd158e41654c812ac7a479eb7`。正式执行须再次经 Firebase 身份和 Slash 钱包 GET 核验，并核对 plan 一致。
- 合入最新 main 后前端回归 97 项通过、后台重新构建通过；采集器 5 项测试通过。平台部署 ID、正式迁移及 apply 结果以本次实际交付记录为准。
