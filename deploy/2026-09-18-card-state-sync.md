# 卡片当前状态同步发布

## 范围

FLOW-CARD-SYNC-01；用户确认将指定用户卡片从导入快照查询扩展为持续状态同步。实施见[流程](../docs/business/card-state-sync.md)。保持内部归属、不可变导入历史与资金账本独立。本批不修改Slash额度，不执行充提，不新增敏感字段显示。

## 版本与验证

- 首版源码a61ff15867d46a22ec67755dc94c3a3b10974085，API dep-daml6sp42hec739i0g1g已live；保留并行TRC20限额充值代码。
- 收紧运营手动刷新至已正式归属项目钱包卡片、修正导入与当前状态说明后，最终源码cfdd45fd017aca6d59a6642b2826c55a838e0b8b，最终API dep-daml9kh42hec739iaks0 于15:14:11 UTC已live。
- 客户端Worker 4d59d4df-623d-4d64-a355-baf68c21d1b5（a61ff15）；运营Worker b6a8a8b0-1840-4511-a291-a570e5e0e965（cfdd45f）。
- 随机本地PostgreSQL全包race通过，覆盖旧通知GET最新状态、钱包错配不发布、重试恢复、过期、历史不变、客户越权、运营MFA和未归属卡拒绝。130项前端/网关测试通过；两端typecheck/build、Go vet和命令构建、Wrangler dry-run通过。最终只改覆盖范围说明后另跑API单元测试及vet。
- 真实Firebase/Blnk测试未启用；没有本人业务会话，登录后的浏览器点击未复验。界面流程由组件测试验证，不能称为线上人工验收。

## 生产证据

1. 只读job-daml4lmk1f9s739fdqk0确认slash-apexis-op-trial与trial_20260918账户匹配，钱包正式归属卡片23张，原通知1467条均done。
2. job-daml66tbedkc73c696h0单事务显式安装017，校验002/010/011及017历史checksum，未执行016或资金迁移。017 checksum：46e7beb47fbb889b87dc8af0f205fc807726bb3edb6aeab6521e70e2da331fbd。
3. job-daml8aou01pc73amif70运行已有API只读账户核验后启用映射成功。首次作业job-daml82h42hec739i4gtg因二进制路径错误失败，无数据库动作；修正为PATH中的api后成功。
4. job-daml9cid0e5s73fsmu30确认23张全部同步：14 active、9 paused，23条done、无排队或错误；checkedAt范围15:09:38–15:11:27 UTC。前后台共同view读取同一状态。
5. 两端线上入口JS/CSS各2份与对应发布构建逐字节匹配。API healthz/readyz均200；两端同步POST未认证401；跨站点路由404。未将未认证检查视为已登录业务验收。
6. 定时第二轮回查：job-damlat142hec739if610确认已累计29条done，另1条正在回查，最近checkedAt推进至15:15:06 UTC；23张核验均在10分钟内，未发生失败。证明无需手动刷新也持续更新。

## 回退和限制

按需停用该card_sync_links映射恢复导入状态显示，保留观察及历史；可回退API至256df2526bd63cfa0a57bc3a2aa4cb8cfe28351b（回退前需核对其他并行发布），017为新增对象可保留。初始周期补查按每5秒一个任务处理，单卡超过5分钟入队，积压会增加延迟；每卡10分钟未核验标记过期，失败显示异常，404不推断销卡。未人为在生产冻结/解冻卡片或伪造Webhook；新卡状态变更通知端到端触发仍待自然事件证据，定时真实GET已验证。交易金额、利用率、可消费额度仍不属于本批同步字段。

工作区原有并行文档修改已保留；两次主线更新兼容合并，备份与stash保留在本机，未强推或覆盖远端。发布不包括无关未提交文档。
