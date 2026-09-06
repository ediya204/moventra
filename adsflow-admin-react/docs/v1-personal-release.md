# V1 个人账户发布范围

2026-09-07，本次从 origin/main a5f09b9 建立独立发布目录，合入客户团队功能下线。保留已发布的真实客户端首页和后台登录准入修复，不覆盖共享开发目录。

- 清理团队菜单、创建/邀请/角色表单、卡片团队筛选与字段、团队资金划拨及团队通知展示。
- 真实客户端首页自动读取个人主体，不再提供个人/企业主体切换。安全页只提供个人业务查询；后台 staffScopes、MFA、客户数据隔离照旧。
- 旧团队页面经认证入口回到个人首页或后台会话页。非 Firebase 的本地模式保持原个人工作台路径。
- 生产 Go 没有团队创建/邀请管理接口，网关白名单继续拒绝旧接口与本地 Demo 接口（404）。共享演示模型另外拒绝遗留团队指令（410），不删除历史原始数据。
- 历史 memberships、customer_id、客户归属、资金和审计数据全部保留；不迁移或重新分配资金，不改变生产角色授权。

## 验证与边界

`node --test adsflow-admin-react/tests/*.test.mjs deploy/cloudflare/gateway.test.mjs`：17 项通过，覆盖模型退役、历史归属/余额保护、跨账户卡号拒绝、注册分流、后台准入与两端网关团队 API 拒绝。

`VITE_SITE_KIND=client npm --prefix adsflow-admin-react run build` 与 `VITE_SITE_KIND=admin VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?需沿用已批准的运营邮箱配置}" npm --prefix adsflow-admin-react run build -- --outDir dist-admin` 分别构建。生产配置分别指向 dist 和 dist-admin，API_ORIGIN 仍为既有 Render。

本次不发布 Go、不执行迁移、不上传本地 Demo 服务/数据库/真实 Slash 快照。完整卡片与资金业务仍有本地演示部分，不能将前端源文件打包视为生产接口已接入。本人登录后业务验收与渠道资金验收单独进行。

发布前版本：客户端 5eaa10ed-560b-4032-8c5c-4c742b54384e，后台 07421c0b-c911-4514-b157-ecfcfb48ad66。需要回退时分别使用对应 Wrangler 配置和版本；本次无需数据库回退。
