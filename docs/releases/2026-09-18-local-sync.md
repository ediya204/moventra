# 本地增量同步与部署（2026-09-18）

用户授权“同步本地代码到 github main，部署”。原共享工作区 HEAD 为 ce0a88a，含大量历史未提交文件；发布在独立工作树 /tmp/moventra-release-20260918 中，以远程 main 为基线逐项合并，未重置原目录。

## 发布范围

- 保留远程已发布的开户、渠道投影、注册用户目录、Blnk 影子模块和本地采集服务。旧工作区 003_user_roles / 004_blnk_shadow 不再引入；main 的 004 / 006 正式编号及所有迁移字节保持不变。
- 补齐客户端本地 Demo 解冻申请界面及类型，使用 main 已有的 unfreeze-request 后端与冻结版本检查；不开放生产卡控制。保留 Moventra 导出文件名。
- 注册预览页的登录链接直接指向 /portal/login；无注册提交或权限变更。
- 同步开发约束、业务闭环标准、历史连通性盘点与本次 Slash/Blnk 调查和来源持久化设计。调查文档新增基线补注，旧源码哈希保持原始证据，不将旧工作区缺文件判断用于最新 main。
- 校正现行构建说明：admin 角色由 Go 确认，无需旧前端邮箱名单。
- 远程后续提交 fdb8906 的 Blnk 私有服务记录和配置完整保留。本次不操作该私有服务、数据库或 Redis。

## 发布前验证

- 冻结锁文件离线安装、两端 TypeScript 与正式构建通过；存在既有大包提示。
- 82 项前端/网关回归、17 项官网 SEO/联系入口/产物检查、136 项本地业务回归通过。
- Go vet/build 通过；真实 Blnk 0.15.4 容器与随机隔离 PostgreSQL 数据库的 race 回归：21 个顶层测试通过，真实 Firebase 授权测试因缺少测试凭据跳过。
- Cloudflare 两端 production dry-run 通过。Wrangler 安装报告 3 项 high 依赖审计项，未在发布中盲目升级部署工具链。
- 生产数据库迁移、客户绑定、真实金融写接口、Slash/Blnk 方案实施及生产账本激活均未执行。上述本地金融测试只使用隔离数据。

## 回退基线

- API：e652305b / dep-dam160ff3r2c73e3i3r0。
- 客户端 Worker：f10901f6-c443-4c83-9229-ba8c3f2a4911。
- 运营 Worker：ce616aa9-75e3-4221-b770-73cf46f225e9。

## 发布结果

- GitHub main 运行源码提交：`524b9989cb7dd0e65b1c95c5d535410988f1101c`；后续发布记录提交仅修改本文件，不改变运行源码。
- 客户端 `moventra-web`：`27a0d224-ceea-41ec-b57a-57890902da9e`，100% 流量；https://moventra.me 与 https://www.moventra.me。
- 运营后台 `moventra-admin`：`4f2f49a0-edfd-480d-8977-094c24186a0f`，100% 流量；https://admin.moventra.me。
- Render API：`dep-dam1fju7bikc73fvn1jg` 已 live，关联精确提交 524b998；UTC 2026-09-17 16:40:20 完成。autoDeploy 关闭、preDeployCommand 为空；本次未修改环境配置。
- 16 项线上 HTTP 检查通过：首页、www、两端登录、注册预览返回 200；对端入口/注册/跨端 API 返回 404；me、用户目录和渠道投影无凭据返回 401；API healthz/readyz 返回 200 JSON。
- 两端主 JS/CSS 共 4 个文件与本次构建字节一致；注册页分包也字节一致且包含 /portal/login。初次 Python 默认 User-Agent 资源探测遇到 403；浏览器 User-Agent 重试均为 200，没有修改边缘安全策略，具体 403 原因未另行取证。
- Render 启动日志确认监听 10000、服务 live；检查窗口未见应用错误。
- 以上公开探测不代表已完成本人 Firebase 登录、MFA 或真实业务验收。未执行生产迁移和真实金融写入，未实施本轮 Slash/Blnk 设计。
- 原共享目录未重置；旧本地 main 与未提交开发仍保留。后续实施须以最新 origin/main 或独立发布工作树为源码基线，不能继续把共享目录旧快照当作线上版本。
