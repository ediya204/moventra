# 卡交易流水：双币种消费交付与验收

实施范围：本地 React + Node Demo API + SQLite。2026-09-06 核验 Slash 官方文档并实现；不连接真实 Slash、不迁移 Go 业务库、不部署。使用既有本地管理会话，真实生产权限/MFA/Webhook 验签不是本次完成项。

## 页面与流程

统一入口 [卡交易流水](http://127.0.0.1:8852/transactions)。原有 33 笔交易和新增 18 笔为同一服务端列表，默认范围内共 51 笔；跨币种 13 笔，同币种 38 笔。仅合并查询，不复制旧记录、不合并金额、不覆盖原有来源与清算证据。

- [跨币种筛选](http://127.0.0.1:8852/transactions?crossCurrency=cross)：跨币种、同币种、币种待确认；原币、账户币种、平台、状态、详细状态、账户、场景、业务类型、时间范围；列选择器、金额/时间排序、后端分页与导出。金额列保留负支出/正收入。
- [主验收详情](http://127.0.0.1:8852/transactions/fx/FX-R001-FX01-T1)：CNY/USD、来源汇率和派生比值、实际采集授权、费用说明与独立流水、退款、净支出、同步及关联证据。
- [本卡交易](http://127.0.0.1:8852/transactions/cards/FX-R001-FX01-CARD)：详情可跳转到真实关联的 Demo 卡；限额/有效期未采集，不伪造。
- [跨币种报表](http://127.0.0.1:8852/transactions/report?scenario=FX01)：按实际入账日或原消费入账日归属，支持 UTC / Asia/Hong_Kong；同页入口查看原有报表。**跨币种精确报表只统计 fx-cross-currency-v1，不将旧数据未经核实接入新的关系净额模型。**
- 根据最新范围调整，暂不提供“跨币种账户快照”和“跨币种待确认”页面入口。旧 `/transactions/balances`、`/transactions/differences` 及对应 `/fx/*` 链接跳回卡交易流水。底层存储和只读接口保留，缺失字段仍如实标注，不自动视为成功。
- 管理总览增加 FX01 验收摘要与报表链接。旧 `/fx/*` 深链接仍可访问；侧栏只保留「卡交易流水」，不再单列跨币种菜单。

正常远程数据模式的原交易页面、旧三态 DTO、Portal 钱包与既有清算页面继续保留。8852 是本次合并列表的本地验收入口，不宣称生产所有平台已接入新统计模型。

## 字段与来源

逐项差异见 [字段差异表](cross-currency-field-gap.md)。官方依据：[Transaction](https://docs.slash.com/api-reference/schema-transaction)、[Get transaction](https://docs.slash.com/api-reference/transaction-get-by-id)、[费用详情](https://docs.slash.com/api-reference/transaction-get-fee-details)、[余额](https://docs.slash.com/api-reference/account-balance-get)、[事件](https://docs.slash.com/api-reference/schema-webhook-event)。

来源字段独立于 `category`、`matching`、`feeTreatment`、采集序号和关系证据。官方 number 的金额/汇率经精确词法解析后在本 API 中转换为十进制字符串，这一**内部传输格式**不冒充原生 Slash schema。示例生成器使用此精确中间格式；保留的 `source` 是白名单投影，不是平台完整原始响应。旧采集中的浮点汇率无法恢复已经丢失的精度，统一列表明确标为旧投影。

金额以 TEXT 整数存储，所有累计用 BigInt；汇率存精确十进制字符串。派生展示比值截断至12位，仅用于解释。列表金额精确排序不 CAST 到 SQLite 浮点或 JS Number。默认 Slash 账户金额 USD/2位；CNY、AED、EUR 演示单位为2位；未确认币种的 scale 保留 null，原始整数可追溯，不机械除100。其他平台按独立账户币种/精度映射，本批 JPY/0位展示真实零值。

Slash 原币对象缺省时，原币币种按来源文档为 USD；不据此制造缺失的原币金额或汇率。FX06 是刻意缺失 `originalCurrency.conversionRate` 的**不完整来源故障注入**，不能作为合法完整 Slash 对象示例。商户、账户、卡片只保存允许的字段；不保存 PAN/CVV/OTP/凭证。

## 存储和增量迁移

`demo-server/slash/migrations/007_cross_currency.sql` 新建：

| 表 | 内容 |
| --- | --- |
| fx_records | 平台当前投影、原币和账户币金额、精确汇率、两层状态、UTC查询时间、来源原值、内部同步/匹配 |
| fx_observations | 每次已返回采集请求的金额和状态、采集时间、是否应用 |
| fx_relations | 消费与退款/费用/返现的关系、依据、确认范围 |
| fx_events / fx_deliveries | 来源事件与多次投递分开；连接+eventId去重 |
| fx_balances | 账户/币种/余额类型快照、期初与完整范围声明 |
| fx_daily | 每日、账户、余额类型、币种、状态、分类、UTC/香港、入账/原订单口径汇总 |
| fx_projection_state | 汇总脏标记；状态或关联变化后重新构建日报，避免重复累计 |
| fx_assets | Demo账户/虚拟账户/卡片白名单、费用详情对象 |

`008_unified_card_transactions.sql` 只新增只读视图 `fx_unified_transactions`，联合旧 `source_records` 和新 `fx_records`。旧表无新增必填列、无删除/重命名。旧退款类型用已有关系辅助识别，旧字段不足时明确待确认。只有币种身份已知才归为同币种/跨币种。

来源身份在连接、实体、来源记录范围内唯一；连接属于单个平台。ID、币种/状态/卡片/入账日有必要索引；每日汇总有时间/账户索引。没有给所有来源字段建索引。附带007/008 down迁移；须停本地服务并与代码一起回退，先清理本模块命名空间，不能使用全库 rollback 清理本次数据。

首次导入前后核对旧23张表行数不变，包括115条来源记录和1条客户端状态。本次写入仅本地 `.sqlite`，非外部数据库。

## 命令

在 `adsflow-admin-react` 目录，使用当前项目 Node（本次 Node 25.7.0，支持 node:sqlite 和 lossless JSON reviver）：

```sh
npm install
npm run slash:import
npm run fx:import
npm run slash:demo
```

本次沿用已安装依赖，未重新安装。启动前端8852、后端8862；首次访问用公开合成账号 `demo@adsflow.local` / `demo-only`，如提示则启用本地管理演示会话。

```sh
npm run fx:import                           # 相同副本不重写、不追加重复记录
npm run fx:import -- --replicas 100 --batch-size 10
npm run fx:status
npm run fx:test
node --test tests/*.test.mjs
npm run build
npm run fx:clean                            # 仅清理 fx-cross-currency-v1
```

固定种子20260906；默认1副本，最多1000副本；批次1..100。旧副本不会因新脚本重新导入而被覆盖；需要重建本批时显式执行 `fx:clean` 后再导入。生产或非loopback数据库/API配置会在打开Demo库之前拒绝。不能将这套生成器改为生产种子脚本使用。

## 场景与预期金额

ID前缀固定 `FX-R001-`，更多副本为R002等。下表仅 Demo 假设，不代表 Slash 真实汇率/费率/关联政策。

| 场景 | 记录后缀（完整ID拼接前缀） | 预期 / 核对 |
| --- | --- | --- |
| FX01 CNY、授权差异、独立费用、部分跨月退款 | FX01-T1、FX01-F1、FX01-R1 | 消费 CNY720 / USD101；授权USD100；费用USD1.01；退款CNY360 / USD49.80。原币净消费 CNY360；美元净支出52.21。费用说明与费用详情不重复算钱 |
| FX02 AED多次退款 | FX02-T1、FX02-R1、FX02-R2 | 消费AED367.25 / USD100；退AED100/USD27、AED50/USD13.50；净AED217.25 / USD59.50 |
| FX03 原币全额退款，美元不同 | FX03-T1、FX03-R1 | 消费CNY720/USD101，退CNY720/USD100；净CNY0 / USD1。原因未确认，不标为汇兑损益 |
| FX04 费用已包含 | FX04-T1 | USD101，说明费用USD1.01；无独立扣款，不加为102.01 |
| FX05 返现生命周期 | FX05-T1、FX05-C1、FX05-C2、FX05-CA1 | 消费USD20；待入账返现0.20不计收入；已入账返现0.50与冲回-0.50抵销，净20 |
| FX06 缺少汇率和费用 | FX06-T1 | CNY100/USD15；汇率、授权金额、费用未知。数值比值可展示但不冒充来源汇率；待确认 |
| FX07 未匹配退款 | FX07-R1 | CNY10/USD1.50收入可计账户流；无原消费归属，订单口径单列未匹配 |
| FX08 乱序响应未补全、余额差异 | FX08-T1 | 晚到pending不覆盖posted USD101；需补同步，posted快照与期初+已知流水差USD0.10 |
| FX09 尚未入账 | FX09-T1 | 授权USD100，已入账支出0；available900、posted1000，仅Demo冻结假设 |
| FX10 其他平台及真实零值 | FX10-T1 | JPY0，0位；与缺失null不同，不受Slash USD规则覆盖 |

FX01：8月入账日净支出102.01，9月净支出-49.80；按原消费入账月归属，8月52.21、9月不归入该订单。FX02 的首笔退款发生8月31日18:00 UTC，香港为9月1日，因此8月UTC净73.00，香港净100.00。

## 采集和对账边界

- 事件仅使用官方 `aggregated_transaction.create/update`，`entityId`指触发事件的交易，不当作所属法律实体ID。连接隔离eventId，重复投递另外保留。
- 模拟通知只标记需要重新读取，测试夹具显式执行模拟GET。没有真实Webhook接收器、验签、队列worker、定时平台补同步或凭证。
- 本地请求序号只防止本系统并发响应回退；不冒充平台对象版本。新请求返回旧pending也隔离。无官方版本时，无法证明平台缓存返回的两个posted内容哪个更新；生产仍需读取一致性策略。
- 日汇总从当前来源交易重建；采集历史不再次计资金。备注费用和FeeTransaction明细不再增加支出；每条真实独立费用交易只计一次。
- 费用与退款只有单一、同账户/实体/币种范围的已确认关系才进入原订单净额。Demo显式关系只在Demo内成立；未知关联不据orderId硬匹配。
- 报表输出各账户/币种/余额类型，不提供无条件跨币种大总和。范围最大366天；CSV单次上限10000条，超限要求缩小筛选。余额当前最多200条，提示按账户筛选。大批量导入验证为分批功能测试，未做生产规模压测。
- 首次观察即posted时，授权金额保留未知；来源采集时间和来源date、事件时间独立保存。历史表是已采集观察，不是全量平台事件史。

## 验证记录

自动化覆盖：核心净额、授权与入账分离、费用说明去重、多次退款与退款详情关联同一订单、跨月两口径、香港日界、返现待入账及冲回、缺失与零、未知币种精度、历史币种精度、超过JS安全整数精确排序/累计、事件去重与旧响应隔离、日报刷新、匹配/缺失/余额差异、HTTP会话门禁、白名单、SQL筛选/导出/分页、重复导入和旧数据保留、统一列表兼容。全部自动化测试 123 项通过（含跨币种专项 20 项）；生产构建通过，只有现有 ApexCharts 大包体积提示。

页面验证：统一列表、双币详情及USD52.21、来源授权USD100、费用USD1.01、退款USD49.80、整行跳转、关联卡片入口；统一列表 51 条；跨币种筛选 13 条、同币种 38 条；同币种翻页保留筛选并显示第 26–38 条。浏览器会话到期现有页面曾返回401，已补充过期后回到本地会话启用入口，避免只剩不可恢复的重试。

待 Slash 确认：originalCurrency金额符号与非两位币种单位；缺省/零费用含义；feeInfo.relatedTransaction.amount单位；FX费与独立流水准确链接；不同卡产品收费规则；退款/返现/撤销/分次清算父关联；全额原币退款产生USD差额的原因；上游GET的一致性和版本机制。以上均不通过伪造状态/字段填补。
