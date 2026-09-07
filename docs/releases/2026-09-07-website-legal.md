# 官网公司资料与政策发布

2026-09-07，经用户“部署”授权，基于 origin/main `f5038dde5166b3914da263a50917e243a68db6dd` 在独立 worktree 发布。旧工作区中的公司资料及政策逐项迁入新客户端结构，没有覆盖新仓库的并行改动。

## 发布内容

- 官网和客户端公开账户流程加入 Privacy Policy、Terms of Service、Cookie Policy 入口及中英文页面。
- 公司主体 Moventra Technology Inc；Wyoming, United States；州登记号 2026-002074896；成立日期 2026-09-07；主要办公与邮寄地址 30 N Gould St Ste R, Sheridan, WY 82801, United States。
- 公司信息来自用户提供的注册证书第 1、4 页，此前已提取并目视核对。公开联系邮箱 info@moventra.me 由用户明确指定；未发布证书文件、申报人个人信息或联系电话。
- 按新源码修正 Firebase 登录、Google 登录、密码重置及登录后资料补全说明；不沿用旧工作区“密码找回仅预览”的过时描述。
- 公开页面响应 Cookie 检查完成后移除草案提示，描述检查范围及第三方 Google 登录仍可能使用自身 Cookie；不宣称已登录流程完成全量 Cookie 审计。
- 仅改 `apps/client`，通过本端 Outlet 布局加入账户页法律入口，没有改变共用认证、后台、网关业务规则或 API。

## 本轮验证

- `pnpm install --frozen-lockfile` 与 `npm ci --prefix deploy/cloudflare --no-audit --no-fund` 成功。独立目录避免旧目录 iCloud dataless 依赖读取阻塞。
- `pnpm build:client`（TypeScript + Vite）通过。迁移时一次构建暴露旧页脚的无关商户 Logo 引用，隔离副本移除该未纳入本轮的依赖后重建通过；旧工作区文件未改动。
- `pnpm check:boundaries`：137 个文件通过。
- 认证准入、会话注册状态及 Cloudflare 网关回归共 16 项通过。
- Node 断言核验三份双语政策中的邮箱、州登记号和地址、无旧预览描述、无草案状态。
- Wrangler 4.129.0 production dry-run 通过，API_ORIGIN 和 SITE_KIND 保持既有值。
- curl 匿名 GET 官网、登录、注册、密码找回均为 200，`/api/v1/me` 为 401；这些响应未设置 Cookie，包含 Cloudflare NEL/Report-To，因此正文补充网络错误报告说明。一次 Python urllib 请求受边缘拒绝返回 403，没有把它作为应用验收依据；curl 与 Chrome 均可正常访问。
- 正式 `/`、`/privacy-policy`、`/terms-of-service`、`/cookie-policy`、`/login` HTML 与构建产物逐字节一致；入口 JS、三份 Legal 模块线上内容与本地构建一致。
- Chrome 验证隐私政策中文公司资料、英文切换、服务条款与 Cookie 政策互链正常。
- 无身份 `/api/v1/me` 保持 401，客户端访问后台渠道接口与本地 Demo 路径保持 404。未登录业务和真实渠道资金验收未执行。

## 云端结果与回退

- 只发布客户端 Worker `moventra-web`，版本 `0009cd24-6952-49a9-bb75-c29fd34f7fb7`。
- 域名：`moventra.me`、`www.moventra.me`，保留旧过渡域名。
- 可回退的上一版本：`3cd4c6b8-7739-4f82-b8be-fa8445b6ee63`。使用客户端 production 配置进行 Worker 回退；本次无数据库变更。
- 未发布运营 Worker、Render API、数据库迁移；未修改用户身份、权限、邮件 DNS 或真实资金。

## 页脚联系方式追加

用户随后要求在官网品牌介绍下添加地址和邮箱。页脚现在复用公司资料中的主要办公及邮寄地址和 `info@moventra.me`，邮箱为 `mailto:` 链接，使用地址与信封图标。仅修改客户端首页组件。

本轮客户端 TypeScript/Vite 构建及 production dry-run 通过；Chrome 在 `https://moventra.me/` 已核验页脚地址、邮箱链接与排版。追加发布版本为 `fc7a8138-3edc-4cab-aee5-4f99244100e8`，上一版本 `0009cd24-6952-49a9-bb75-c29fd34f7fb7` 可回退。未重复执行此前 16 项回归；未发布后台、API 或数据库。
