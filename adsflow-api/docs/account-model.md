# 账户模型与第一阶段接口边界

已确认需求：运营后台 + 客户端；个人与企业都支持；个人可升级企业。

## 模型

`users` 表示登录的人，以 Firebase UID 关联身份服务，邮箱不作主键或授权键。

`customers` 表示持有业务关系的主体：

- personal：绑定唯一个人所有人，一名用户最多一个个人主体；不接受企业成员关系。
- business：通过 memberships 关联成员，一名用户可加入多个企业。
- 审核 onboarding_status 和服务 service_status 独立；批准资料不自动开通业务。

`accounts` 表示主体下的业务账户，主子账户引用不能跨主体。个人/企业主体是数据范围边界，不等同于 Firebase Identity Platform tenant，也不从前端选中主体直接推导权限。

`staff_grants` 表示运营人员对特定主体和资源的授权；企业 owner/admin 不自动成为平台运营。现阶段运营仅有 accounts:read / transactions:read，全部要求已完成 MFA 的身份凭据。读取必须成功写入 audit_events 才返回数据。

## 个人升级企业

升级是原登录身份下申请企业主体，保留个人主体和历史资金归属；不能直接将 customers.kind 改为 business，也不能将旧交易改写成企业交易。

当前实现：个人所有人提交企业名称 → 创建 submitted 申请及审计 → 可读取最新申请。同一 Idempotency-Key 和内容返回同一申请；同键不同内容报冲突；并发提交最多生成一条未完成申请。其他个人、企业成员和无所有权的运营不能替个人提交。

后续实现：补充企业资料/受益人等业务要求 → 有权限运营审核 → 批准后创建关联企业主体及申请人的 owner 成员关系 → 独立激活企业服务。驳回允许重新申请，批准后不允许再用此个人主体重复升级。审核人、时间和关联企业在表结构中已有约束，但本轮没有审核接口。

个人账户继续开放还是升级后限制新增业务，尚待产品规则确认；默认保留访问与历史查询。任何资产迁移都需要独立授权和账务流程，不附带在升级中。

## 查询契约

`GET /api/v1/me` 返回本地用户 ID 和可访问客户主体。

`GET /client-api/v1/customers/{customerID}/accounts|transactions`：个人所有人或企业有效成员可读。当前企业 owner/admin/viewer 均为企业全范围只读，尚不支持限制到部分子账户。

`GET /admin-api/v1/customers/{customerID}/accounts|transactions`：MFA + 对该主体该资源的 staff_grants。

列表支持 limit=1..100（默认 50）、offset=0..10000（默认 0）；使用 limit+1 判断 hasMore。查询按固定字段排序，跨请求有新数据时 offset 分页可能移动；未来大规模历史扫描应改游标。未实现的过滤字段会返回 400，避免悄悄忽略条件。不存在和无权主体统一 404。

金额使用 amountMinor 十进制字符串 + currency + scale，direction 单独表示收支。transaction 投影不用于余额推导或出款判断。

所有响应 no-store。错误体 `{ "error": { "code": "..." } }`，认证失败 401，本地用户禁用/MFA 缺失 403，未知/不可访问资源 404，参数错误 400，升级冲突 409，JSON 类型错误 415，依赖或审计故障 503。

## 待确认的业务项

企业资料与审核清单、个人升级后服务政策、子账户成员范围、是否允许一人多企业、首期币种/精度、客户注册开放方式、运营授权审批方式。当前提供的查询基础不能作为资金业务已完成的依据。

## 2026-09-07 Firebase 登录联调

`/api/v1/me` 追加 `operator`、`mfaVerified`、`requiresMfa`、`staffScopes`。operator 仅表示存在 staff_grants，不是全局角色；未验证 MFA 时 staffScopes 为空，数据接口始终再次检查权限。真实 Firebase/TOTP 与本地隔离库的 16 项联调通过。

受控命令 `api provision-user` 使用 `PROVISION_FIREBASE_UID` 和 `PROVISION_EMAIL` 指定目标，经 Firebase 验证 UID/邮箱匹配且未禁用后仅插入 users。重复运行不重新激活禁用用户、不分配客户关系或 staff_grants。此命令不经 HTTP 暴露，不含密码设置或邮箱验证旁路。

## 2026-09-07 Google 登录后注册分流（本地新增，未部署）

已存在的有效本地用户继续进入 `/session`，运营仍要求 MFA 和资源授权。已验证 UID 不存在时 `/api/v1/me` 返回 `403 registration_required`，进入姓名/密码补全表单；停用用户返回 `403 user_disabled`。旧 `user_not_enabled`、网络异常和服务错误均不得进入注册。

密码用 Firebase `linkWithCredential` 关联当前 UID，已有密码不覆盖；密码不发送给 Go。设置密码成功但业务创建失败时，下次识别已绑定的 password provider，仅重试业务创建。`POST /api/v1/register` 只收姓名，核验 Firebase token 后按 UID 幂等插入 users；拒绝客户端自报 UID/role、未知字段和多段 JSON。停用用户不重新激活。注册仅创建登录用户，保留 UID、创建时间，不自动创建客户主体、成员、账户、资金服务或运营权限，无数据库结构迁移。

本地 Vite 新契约 `/api/v1/`、`/client-api/v1/`、`/admin-api/v1/` 使用 `VITE_GO_API_PROXY_TARGET`（默认 localhost:8870），与旧后台代理隔离。非 JSON 身份响应明确提示服务异常；仅带 403 的 registration_required 才显示注册表单。

本轮前端构建通过；本地隔离 PostgreSQL race 测试通过，含六并发注册去重、无凭据/伪造身份拒绝、额外授权字段拒绝、禁用不复活及新用户无运营权限。真实 Google 密码关联、生产注册未测试；前端、Go 与网关需要一起发布，此文不代表已部署。

## 受控个人主体关联

`api provision-personal` 使用明确的 PROVISION_FIREBASE_UID / PROVISION_EMAIL 核验已验证且未禁用 Firebase 身份，再要求本地 users 为 active。事务锁住用户并创建唯一 personal 主体（draft/inactive），仅首次创建记录 personal:provision:user-request 审计。重复运行返回原主体，不修改其状态，不创建 accounts、memberships 或 staff_grants，不影响资金。该命令仅供获得用户授权后的受控运维执行，不是公开自助接口。
