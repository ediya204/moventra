# 客户卡片敏感信息：远程获取、临时展示

## 完整卡号增量（2026-09-19，本地未部署）

用户本轮明确要求完整卡号显示。卡面打开侧栏后调用 `POST /client-api/v1/customers/:customerID/card-projections/:connection/cards/:id/details/reveal`，同一响应包含 pan、cvv、name、expiryMonth、expiryYear、source、cardId、expiresAt。普通列表和详情仍不返回PAN/CVV，只增加 detailsAvailable；原 `/cvv/reveal` 仍仅返回CVV。

本次核验[Slash Retrieve card 官方文档](https://docs.slash.com/api-reference/card-get-by-id)：必须使用 `https://vault.slash.com/card/:id?include_pan=true&include_cvv=true`。复用服务端密钥及 CARD_CVV_ENABLED 开关；不读取真实卡数据验证。卡、账户、钱包身份和字段格式验证失败时不披露；当前用户/客户归属在远程查询前后检查。客户端Bearer认证、无二次认证的既有决定不变。

PAN与CVV仅在带隐私标记的DOM节点临时展示，30秒到期、失焦、隐藏、关闭或卸载共同清除；清除时中止请求，迟到响应不得重新显示。HTTP private/no-store，网关错误不透传上游正文。两种读取共用原 `card:cvv:*` 审计/限流桶，不通过切换接口绕过次数；审计无敏感值。字段不进入普通投影、日志、导出、React状态或本地存储。

旧CVV发布证据见[原发布记录](../../deploy/2026-09-19-card-detail-cvv-release.md)，不代表本批完整卡号已经部署或真实租户已验收。

## 原 CVV 接入记录（2026-09-19，实现阶段记录）

客户正式卡片详情已接入临时 CVV 展示及独立 Go 查询接口。用户已决定本期不做二次验证：沿用现有 Firebase Bearer 登录，每次复核客户、连接、卡片当前归属及有效用户状态；不引入旧原型的 HttpOnly BFF 会话合同。下方历史正文保留原设计，不覆盖本节。

## 当前仓库状态（2026-09-19，本地实现，未部署）

客户正式卡片详情已接入临时 CVV 展示及独立 Go 查询接口。用户已决定本期不做二次验证：沿用现有 Firebase Bearer 登录，每次复核客户、连接、卡片当前归属及有效用户状态；不引入旧原型的 HttpOnly BFF 会话合同。下方历史正文保留原设计，不覆盖本节。

`POST /client-api/v1/customers/:customerID/card-projections/:connection/cards/:id/cvv/reveal`，请求体仅 purpose=cardholder-view。当前来源须为正式项目钱包归属且存在有效 card_sync_links / slash_hook_connections。服务端配置 `CARD_CVV_ENABLED=true` 与既有 `SLASH_API_KEY` 才启用；默认关闭。2026-09-19已获授权配置生产开关并部署，真实安全码未读取，见[发布记录](../../deploy/2026-09-19-card-detail-cvv-release.md)。

服务端每次实时 GET Slash Vault 单卡 include_cvv=true&include_pan=false，仅请求CVV并解析归属验证字段，丢弃上游任何额外PAN字段；不使用投影导入或来源事件持久化链。上游失败使用固定错误，网关不透传错误正文。响应 private, no-store，前端拒绝缺少no-store的成功响应。成功响应未套通用data封套，避免进入通用查询状态。

数据库事务锁协调跨实例限速：每用户每分钟10次，每连接卡片每分钟3次；仅使用不含敏感值的审计事件计数。查询后再次核对归属，撤销授权不得返回安全码。审计只记录查看人、卡片范围、时间和结果，不记录响应正文。API/CDN/APM生产配置仍须上线时复核，本地代码不能证明外部采集系统配置正确。

前端不预取，点击才带登录token查询；最多30秒展示，隐藏、失焦、切卡、离页及卸载清除并拒绝迟到响应。无复制、持久存储或查询缓存。浏览器展示期间存在临时内存，不保证物理内存清零或防截图。新开卡仅在服务端核实同客户、同供应商账户的渠道映射后进入相同详情；未映射不开放CVV。

实现、测试和页面路由见[卡片详情流程](../business/customer-card-binding.md#flow-card-detail-001卡片详情与充提2026-09-19)。

## 历史记录正文

## 当前实现与未接入部分

单卡详情的概览增加 CVV 区域：默认掩码、点击查看、加载、隐藏与错误提示。安全码不存入 Card/State、浏览器持久化存储、CSV 或本地文件。展示值仅写入专用临时 DOM 节点；React 状态只记录加载阶段和过期时间。

当前卡片来自本地合成模型，没有经过客户认证的远程卡片身份。因此页面展示掩码和禁用的查看按钮，不请求真实 CVV，不提供随机/固定安全码或本地回退。

仓库里没有可核实的客户 CVV 接口和上游实现。本次提供的是前端展示组件、调用合同和生命周期防护，**没有接通真实上游，也没有验证远端日志或缓存行为**。等待接口文档及认证方式后才能完成真实集成。

## 组件边界

- `RemoteCardCvv.tsx`：专用 UI，只接受客户专用 API 返回的 `RemoteCardIdentity`。当前演示页面不传入远程身份。
- `remoteCvv.ts`：发起单次远程读取，消费响应并临时渲染，不向调用者返回安全码。
- 每次查看重新获取；请求最长 10 秒，展示时间取远端过期时间与 30 秒上限的较早值。
- 隐藏、窗口失焦、页面可见性改变、页面退出、路由变化、卡片切换、组件卸载时清空并中止请求。
- 使用请求序号拒绝乱序/迟到响应。清空后的旧请求不能重新显示内容。
- 无复制按钮，不写剪贴板，不自动预取，不接入查询缓存。
- 请求和解析异常仅使用固定提示，避免将上游响应正文或错误对象写入日志/界面。
- 敏感节点标记 `data-private`、`data-sensitive`、`data-hj-suppress`、`fs-exclude`、`ph-no-capture`。这些标记不能代替生产埋点/回放系统的实际排除配置。

显示必然需要短暂的浏览器内存和 DOM。JavaScript 字符串不能保证物理内存清零；清除是移除引用及显示内容，并非对浏览器开发者工具、用户截图或操作系统进行控制。

## 待实现的客户后端合同（不是已存在的接口）

`POST /client-api/cards/:remoteCardId/cvv/reveal`

- 同源客户 BFF，使用独立 HttpOnly 客户会话；不得复用管理员 token。
- JSON 请求体只有 `purpose: cardholder-view`，不含 CVV 或上游密钥。
- 请求采用 `credentials: same-origin`、`cache: no-store`、`redirect: error`、`referrerPolicy: no-referrer`，附带自定义请求头以配合服务端 CSRF 策略。
- 后端必须核实客户身份、当前卡片归属、查看权限和近期安全验证；验证 Origin/CSRF。前端传入的卡片 ID 不是授权证明。
- 后端按已验证卡片映射到上游，并在每次请求时实时读取；上游凭据只能保存在远程服务端。
- 成功 JSON 字段：`source` 必须是 `upstream`，`cardId` 与请求匹配，`cvv` 是长度 3 或 4 的数字字符串，`expiresAt` 是短期 UTC 时间。文档不提供实际或固定样例安全码。
- 响应必须包含 `Content-Type: application/json` 和 `Cache-Control: private, no-store`。前端拒绝缺少 no-store 的成功响应。
- 身份失效或需进一步验证返回 401/403；前端显示固定提示，不读取错误响应正文。登录/二次验证流程仍需正式客户认证模块接入。

远程 BFF、上游适配器、CDN、服务工作线程、APM、错误采集、请求抓包、审计与日志管道都必须排除响应正文。审计只保留查看事件的主体、卡片内部标识、时间、结果等非安全码字段。不得把响应体落库、缓存、写文件或放进队列。

## 后续接入

真实客户卡片数据接入后，把服务器返回的卡片身份传给 `RemoteCardCvv`。不要把演示卡 `1001` 等本地 ID 当成真实远程卡片身份，也不要增加 VITE 上游密钥、管理端接口回退或本地 CVV fixture。

需要先取得：客户 API/上游 API 文档、客户认证方式、真实卡片标识映射、远端“不存储响应正文”的配置与验证证据。真实 CVV 联调不应使用屏幕截图、DOM 导出、日志、快照或测试报告记录真实响应。

## 历史验证

`node --test tests/portal-cvv.test.mjs` 使用运行时生成的合成值，仅在测试内存中模拟响应；测试输出不包含安全码。

覆盖：不缓存请求、30 秒清空、远端更短到期、隐藏后迟到响应、乱序响应、组件卸载、失焦、超时、卡片身份匹配、非上游来源、错误正文隔离以及 401/403。
