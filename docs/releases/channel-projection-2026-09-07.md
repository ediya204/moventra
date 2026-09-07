# 正式后台卡交易只读投影

2026-09-07。用户明确授权卡交易页及真实只读数据接口上线。此次不接入资金写操作，既有客户账本与运营总览投影不变。

## 页面与来源

正式后台 `/transactions`：商户/Logo、卡名称与尾号、原币金额、USD账户金额、来源状态、授权/入账时间、查看详情；服务端筛选分页。筛选含商户/尾号/交易ID、卡消费详细状态及UTC来源日期半开区间。刷新只读取已导入数据库，不代表请求Slash或实时更新。

详情复用原交易抽屉，展示原始商户信息、金额、MCC、单行地区及卡关联。`/cards/:id?connection=...` 查询精确连接内的卡资料。未绑定内部用户统一显示未绑定，不从上游卡名或Demo关系推定归属。正式客户端不展示未归属客户的渠道数据；其Logo组件已具备，商户数据业务页仍待正式接入。

首批导入为本地只读采集的5573笔卡交易与260张关联卡，来源观察时点2026-09-07T04:00:21.749Z。不是完整渠道资金池，不作为可用余额或对账通过依据。源日期是随来源状态变化的日期，授权时间独立；金额是精确整数字符串，不重算上游实际扣款。

## API与授权

- `GET /admin-api/v1/channel-projections`：当前操作员可读连接。
- `GET /admin-api/v1/channel-projections/:connection/transactions`：page（20条）、keyword、detailedStatus、from/to、revision；未知/重复参数拒绝。
- `GET /admin-api/v1/channel-projections/:connection/transactions/:id`：精确交易。
- `GET /admin-api/v1/channel-projections/:connection/cards/:id`：精确卡资料。

所有资源要求Firebase有效身份、启用的内部用户、MFA、现有staff角色和独立channel_read_grants。客户transactions:read不会自动授予渠道权限。每次读取与审计在同一事务内；审计失败不返回记录。未授权具体资源返回404，客户端站点网关拒绝所有渠道端点。线上没有此模块的公开POST、上游代理或凭据接口。

列表返回rows、total、page、revision、sourceAt、importedAt、complete=false、syncMode=manual_import与覆盖说明。输入版本与当前版本不同时409；前端刷新连接水位后重查。状态原值保留，图标只做品牌展示。

## 数据结构与手动导入

增量002仅创建channel_connections、channel_read_grants、channel_imports、channel_records、channel_read_audit。来源定位由connection/resource/external_id组成；历史导入版本保留，当前连接指向一个完整原子提交版本。金额不进入旧transactions表，不产生资金分录或修改账户余额。

导出命令（真实文件是私有资料，禁止提交仓库）：

```sh
python3 services/api/scripts/export-channel-projection.py --database /private/path/live.sqlite --output /private/path/projection.json
```

脚本以只读SQLite事务导出白名单，排除PAN/CVV/OTP、密钥、Demo归属及来源大对象。服务端导入再次校验白名单、金额格式、时间、卡关系、来源账户、重复身份和规模上限；拒绝过期覆盖。仅允许有界64MiB/50000条输入。

先显式执行`api migrate`；然后在受控运行环境配置DATABASE_URL与明确的PROJECTION_OPERATOR_UID，使用`api import-channel < /private/path/projection.json`。导入目标必须是既有启用运营用户，授权仅限本连接；不自动创建用户或变更客户权限。相同内容幂等，整个版本事务提交，失败回滚。重新采集Slash仍按既有本地手动流程；本轮未将Slash密钥搬到云端，没有伪装为线上一键同步。后续再将采集作业迁入正式服务。

## 迁移、验证与回滚

生产迁移前完整pg_dump、SHA256及隔离本地恢复已验证。原users/customers/accounts/transactions/staff_grants逐行摘要保持一致。仅临时开放本机单IP访问用于迁移导入，完成后已恢复原空IP白名单。

本次隔离PostgreSQL race测试验证默认拒绝、MFA、跨范围、重复/旧导入、精确大整数、分页、版本冲突及审计失败；合入远端日期筛选改动后，前端回归52项通过。Go race测试、go vet、两端TypeScript检查与生产构建通过；保留现有图表依赖大包提示。以上不代表真实用户已登录验收。

回滚采用前一Go及Worker版本；新增表保留，不删除历史投影或逆改001。可撤销独立渠道读取授权以暂停展示；不回滚客户账本，因为本次未改账本。

官方字段依据：[Slash Transaction](https://docs.slash.com/api-reference/schema-transaction)，2026-09-07复核。当前能力是来源投影，不能推定退款父子关系、完整账单或上游执行能力。


## 本次正式发布结果

- 业务代码已同步GitHub main：`0d5158d90a6f050d54480020f15ddbaf7303a204`。
- Render API发布：`dep-daf3v90u01pc738o7s40`，2026-09-07T04:39:35Z已live；`/readyz`返回200。
- 后台Worker：`2f7ca654-ec7c-476f-adf9-207e157d4803`；[卡交易入口](https://admin.moventra.me/transactions)及页面JS与本次构建逐字节一致。
- 客户端Worker最终production版本：`3cd4c6b8-7739-4f82-b8be-fa8445b6ee63`；登录页与本次构建一致。客户端发布应显式使用`--config deploy/cloudflare/wrangler.jsonc --env production`；本次曾误用默认配置，已立即重新发布正确production绑定，并核验`/api/v1/me`返回401而非配置缺失503。
- 线上未登录渠道查询返回401；客户端渠道查询404；后台渠道写请求405。Python默认User-Agent曾被边缘规则拦截，使用浏览器及curl复核，不把边缘403作为应用权限验证。
- 浏览器真实访问后台卡交易入口后进入登录页。登录后的Logo显示、运营数据读取及详情跳转尚待已授权运营用户登录验收，未冒充此验收已完成。
- 生产只读投影新增260张关联卡、5573条交易；无生产金融写接口调用，无真实划款。该批数据仍为上述来源观察时点的快照，未来采集/导入保持手动，Webhook未接入。
