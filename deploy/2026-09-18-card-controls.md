# 卡片事件驱动与状态操作发布

## 范围和流程

用户确认取消五分钟全量补查。客户端卡片详情及后台卡片详情增加启用、停用、注销确认入口；只修改Slash status。注销保留历史。Webhook验签持久化后GET对应卡片更新共同状态；不信任乱序事件内容覆盖当前值。详情保留手动核对。页面15秒读取本系统不触发渠道查询，队列每5秒检查也不等于渠道轮询。

完整接口、权限、异常和恢复见[FLOW-CARD-CONTROL-02](../docs/business/card-state-sync.md)。额度、资金、CVV均不在本批变更。未对任何现有卡片执行启用、停用或注销来验收。

## 验证与部署

- 设计：用户确认；官方PATCH status及Webhook重复/乱序规则已核验。
- 本地：018、持久命令、幂等及同卡互斥、执行前归属核验、未知响应只GET恢复、两端确认弹窗与处理中展示。
- 自动化：发布合并版本4211d05的136项前端/网关测试、两端typecheck/build、Go vet、随机隔离PostgreSQL全包race通过；两端Wrangler dry-run通过。真实登录浏览器及真实PATCH未测试。
- 真实渠道：15:29 UTC生产只读预检确认既有连接/通知账户/项目钱包匹配、23张正式归属卡；尚未以此证明真实PATCH成功。
- 部署：018已安装（job-damlj6ajnfac73b4t8ag），checksum 67a02e1e8e2801abda5fdcecdadb67b3d8fb174d9bab32f1c764d42537879457。API4211d05于15:36 UTC上线，后续资金任务859dda3包含相同卡片代码，最终dep-damlle1q582s738pu8v0于15:38:41 UTC live。
- 前端：客户端版本3e0d49f0-430f-4a4f-b865-55033b247c32，后台ab9be9a6-18a2-417f-a771-e4bea0c6ef7c，构建源4211d05。正式域名资源逐字节匹配构建产物；healthz/readyz 200，未登录actions 401，跨端404。
- 操作能力：job-damll1ijnfac73b53ssg真实GET核验账户成功后仅开启slash-apexis-op-trial，23张正式归属卡。
- 最终只读核验：job-damlqth42hec739k879g于15:49:17 UTC确认23张synced、14 active/9 paused、card_control_commands为0。旧周期事件总数137、最后15:36:57 UTC、queued为0；与15:37:46基线一致，超过12分钟没有新增周期任务。旧版本发布交替时产生的记录保留，未删除来源历史。

## 恢复和回退

未知操作进入review后禁止相反命令；手动核对或Webhook GET确认目标状态后可解除。不能把未知命令改成失败来重发PATCH。关闭controls_enabled可停用新命令，已发送结果仍须核对。不要回退到带周期补查的旧worker；需要回退时先停worker和操作入口，保留018及命令证据，不删历史。017原导入与正式归属保留。
