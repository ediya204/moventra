# Cregis 接入：协议基础与待接线范围

日期：2026-09-18。源码基线 `0f79ebd`。本批新增 Go 内部协议包；没有启用运行时、迁移、回调 HTTP 入口或后台菜单。

## FLOW-CREGIS 协议到来源观察

| 项目 | 范围与下一阶段 |
| --- | --- |
| 目标 | 为正式数字货币流水提供可验证的渠道协议基础；产品类型和配置确认后再接通查询投影 |
| 页面关系 | 本批无页面变动；数字货币流水及出金审批仍不可用 |
| 业务身份 | 未来持久化按连接、项目、回调种类、cid 隔离；txid 不等于唯一转账，第三方订单号单独保留 |
| 数据权威 | Cregis 原始字段为渠道观察；不推导客户余额或客户归属 |
| 接口链 | 当前仅签名函数、验签、类型校验 → Observation；网络调用、持久化、授权查询仍未实现 |
| 状态及动作 | 充值与出金使用独立类型；保留原始状态及金额字符串；验签失败、项目不符、格式错误返回错误 |
| 跨端影响 | 无线上变化；不转换为 Blnk 命令，不改变 Slash 或测试资金 |
| 权限 | 密钥仅由服务端调用者传入；后续后台接口必须继承 MFA、连接及客户资源授权，不能仅凭登录开放项目全量流水 |
| 异常恢复 | 未来需先持久化并去重，再返回回调 success；本包不提供 HTTP 应答或重试处理 |
| 验收 | 官方签名向量、独立 HMAC 向量、金额/ID 精度、篡改及重复字段、类型与终态校验；仅离线测试 |

## 已实现与协议依据

`services/api/internal/cregis` 包实现 WaaS 扁平参数签名及同项目验签、Team API 精确请求字节签名。拒绝浮点数、重复 JSON 字段及嵌套对象，保留零值和 int64 ID。Team API 尚未实现请求客户端及 JCS 序列化。

官方依据：[产品入口](https://developers.cregis.com/en/introduction/)、[WaaS 鉴权](https://developers.cregis.com/en/waas-authentication/)、[Team API 鉴权](https://developers.cregis.com/en/team-api-authentication/)、[充值通知](https://developers.cregis.com/en/reference/waas-api/depositCallback/)、[出金通知](https://developers.cregis.com/en/reference/waas-api/payoutCallback/)。

验签只证明报文完整性。包不提供防重放存储；时间戳只校验正整数，允许历史通知重试。充值成功与出金成功的状态类型和取值分别校验。金额保持十进制字符串，不自行假设资产精度。未提供链上 transfer index，不填造索引或设置 finalityVerified；正式入账仍受 [Blnk 规则](blnk.md) 与客户地址映射约束。

## 待确认和接线

用户提供了官方文档；仍需确认使用 WaaS、Team API 或两者，以及 Base URL、项目 ID 和已配置凭据的位置（不在聊天提供密钥）。之后实现只读交易客户端、来源存储、连接/客户授权及后台流水；真实 OTC 报价、出金审批执行和正式账本需分别完成业务契约与验收。

本批 `CGO_ENABLED=0 go -C services/api test ./...` 通过，含官方 WaaS 向量、独立 HMAC 向量及 15 组回调类型/异常场景；`pnpm docs:index`、`pnpm docs:check` 通过（126 份 Markdown）。真实渠道调用、数据库联调、浏览器流程及部署均未执行。旧 Cregis 候选代码仍未找到，本包是依据官方文档新增的实现。
