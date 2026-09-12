# FLOW-005 开户审批后默认开放客户端功能

2026-09-13 用户确认规则：后台审批开通后，默认开放全部客户端功能，不逐项分配客户功能权限。状态：已完成生产迁移、Go及两端发布和现有运营范围授权；详见[发布记录](../releases/2026-09-13-onboarding-default-features.md)。未代客户执行审批。

## 流程与范围

| 项目 | 实现 |
| --- | --- |
| 基线 | main e227089；隔离实现 /tmp/moventra-client-publish-20260913；共享旧工作区含其他未提交修改 |
| 客户入口 | /portal 各业务页的“开户与功能权限” → 提交开户申请 → submitted/inactive |
| 运营入口 | /workbench → /onboarding → /onboarding/:customerId → 填写说明 → 审批并开通全部功能 |
| 成功状态 | 同一事务将 onboarding_status=approved、service_status=active；两维状态保留，allFeaturesEnabled=true，不创建假账户、余额或交易 |
| 拒绝与恢复 | submitted 可驳回到 rejected/inactive；客户可重新提交。approved/active 可暂停为 suspended；恢复后默认全部开放；已有 approved/inactive 可显式开通 |
| 权限 | 客户限个人所有人；运营要求 Firebase MFA + 指定客户 onboarding:review；现有只读授权不自动升级，不允许客户自批 |
| 状态同步 | 每15秒在可见页面重新读取，以及操作后/手动刷新；切换客户、旧响应和写期间读取不会覆盖新结果；失败清除开放状态 |
| 并发和审计 | 客户行锁、权限行共享锁、revision 比较；旧修订返回409并重新查询，不重复激活。状态、onboarding_events和audit_events同事务，审计失败全部回滚 |
| 数据依据 | PostgreSQL customers；个人主体仍由现有注册/受控关联流程提供。这里的提交不是完整KYC材料采集；审批依据由运营外部核验后填写说明 |
| 跨端ID | 两端都使用同一个 customerId、revision、onboardingStatus/serviceStatus；后台直接深链可重查 |

## 精确接口

GET /client-api/v1/customers/{customerID}/onboarding
GET /admin-api/v1/customers/{customerID}/onboarding

返回 data：customerId、name、onboardingStatus、serviceStatus、revision、allFeaturesEnabled。

同路径 POST 接收 `{action, revision, reason}`。客户端仅 submit；后台支持 approve_activate/reject/suspend/resume/activate，后台说明必填、最多500字符。拒绝未知字段、多段JSON、非JSON、缺少revision、跨主体和缺少MFA/权限。新建数据库迁移003扩展审批权限枚举、修订号和事件表，不改变既有迁移内容。

客户端 transport 与 Cloudflare 网关均精确允许上述路径的 GET/POST，保留两端隔离。任何真实资金执行接口未来必须独立验证客户所有权、服务开放、余额、限额和风控，不得把前端开关当作执行授权。

## “全部开放”的含义

资金、卡片、交易、消息、工单、设置统一获得功能资格；新增功能无需逐客户再次授权。前端四项快捷入口在已审批且active时开放，暂停/未知状态禁用。已授权历史账户/交易与安全设置仍可查看。

当前充值、兑换、开卡、消息、工单等正式办理接口仍未接入。开通客户进入页面会看到“功能权限已开放，办理接口尚未接入”，不再错误归因“账号未开通”。本批只完成开户状态与默认资格链路，不能称为全部业务已可执行；下一批仍需逐项接通真实服务与金融状态机。

## 发布前验证记录（生产结果见发布记录）

- 两端TypeScript检查、客户端及后台Vite构建通过；后台仅做未配置运营邮箱的默认拒绝构建，不作为可直接上线产物。
- 完整前端/网关回归61项通过（含新增默认开放/暂停、申请提交与失败恢复、网关GET/POST及跨端拒绝）。
- 本机 /tmp PostgreSQL socket 随机 moventra_test_* 库，Go race 全套通过；新增开户测试涵盖客户越权、自审批、缺少审批授权/MFA、并发仅一次生效、暂停恢复、审计失败回滚、账户数量不变、迁移重放。
- 自动化使用隔离身份与数据；真实Firebase、浏览器双会话、正式渠道未验收，不宣称生产闭环完成。
- 生产生效需要另行授权003迁移、Go及两端/网关发布，以及指定审批人员和客户范围的 onboarding:review 授权。没有自动授予现有只读运营审批权。

## 本次发布授权补充

用户已授权生产发布，并明确同意沿用现有后台账号和客户范围授予审批权限。使用受控命令 `CONFIRM_EXISTING_CUSTOMER_SCOPES=yes api grant-existing-onboarding`，不是默认把未来只读授权升级。命令保持个人所有人与运营隔离，范围与审计同事务，重复运行不重复授权或审计；新增隔离测试检查范围、停用/混合身份排除、幂等和审计失败回滚。具体上线状态另见发布记录。
