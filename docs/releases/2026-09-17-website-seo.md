# 官网 SEO 专项发布

日期：2026-09-17。用户授权「同步，部署」。官网 SEO 已部署；Google Search Console 所有权验证、站点地图提交和实际收录尚未完成。

## Git 与部署基线

- GitHub main 原基线：`cfb7a2aa62d39f02a59ba9311639445038e7be1d`。SEO 主线代码提交：`499f891`。
- 同步目录：`/tmp/moventra-seo-release-20260917`，只提交 14 个明确列出的 SEO 文件/改动；保留原共享目录 `/Users/edi/Documents/ChatGPT/moventra` 的旧本地 main 和所有无关未提交工作，没有在原目录执行 reset、覆盖或批量暂存。
- main 比共享目录的 `ce0a88a` 新 26 个提交；最新 main 构建入口为 `index-Nu8n7ysH.js`，与线上 `index-lgk02I0M.js` 不同。因此不直接部署最新主线构建。
- 实际生产候选：基于现有线上客户端源码 `85ccf6e14d85e4981589ef5e0da4840edbfa3f9d`，只 cherry-pick 本次 SEO；得到 `41c01f1`，已同步到 GitHub 分支 `codex/website-seo-production`，目录 `/tmp/moventra-seo-production-20260917`。
- cherry-pick 唯一冲突为 `package.json` 测试脚本上下文；保留生产基线原脚本，仅增加 `test:seo`。既有网关、认证、业务源码、依赖锁文件和 API 地址均沿用生产基线。
- 发布前重建线上基线，首页 HTML 及入口、Website、AuthLayout、LegalLinks、ClientHome、LoginPage、RegisterPage、SessionPage 共 9 个文件与线上逐字节一致，确认没有以历史文档替代当前核验。

## 发布内容与结果

- 仅客户端 Worker `moventra-web`：`d6a19345-d429-4aab-9492-6746f68a3641`。
- 生效域名：`moventra.me`、`www.moventra.me`；旧过渡域名保留绑定但继续 noindex。
- 回退 Worker 版本：`a1f68672-b2ea-473d-9546-e8e085593b94`，发布前重新读取确认。
- Wrangler 4.129.0：`wrangler deploy --env production --old-asset-ttl 86400`；旧静态资源保留 24 小时，降低已有浏览器会话出现旧分包缺失的风险。
- 首页返回带可见正文的 HTML，含 index/follow、唯一 canonical、中英 metadata、Organization/WebSite JSON-LD；`robots.txt` 返回文本，`sitemap.xml` 返回 XML 且只包含规范首页。
- 登录、账户、政策及未知路径保留 noindex；内部首页构建文件直接访问 404；`/index.html` 301 到规范首页。
- 首页 HTML SHA-256：`f8c34973cd5afe8c2756628b60d32d1a7f2b3ed8ad68aa810a6d26096ca5a6c4`。

## 本次验证

| 环境/维度 | 结果 |
| --- | --- |
| 最新 main + SEO | 客户端 TypeScript/Vite 构建、12 项 SEO 测试、79 项现有回归通过 |
| 实际生产候选 | 客户端 TypeScript/Vite 构建、12 项 SEO 测试、67 项既有回归、5 项咨询表单测试通过；依赖边界检查通过 |
| Workers 本地 | API_ORIGIN 置空；16 项实际 HTTP 检查通过；未调用生产业务 API或发送咨询邮件 |
| 部署预检 | production dry-run 通过，70 个构建资产，Worker startup 5 ms |
| 线上 HTTP | 根域/www 各 13 项，加模拟 Googlebot UA 首页请求，共 27 项通过：HTML、robots、sitemap、noindex、重定向、内部文件 404、跨端隔离、匿名身份 API 401 |
| 线上资产 | 25 个 JavaScript 文件均与实际发布产物逐字节一致；管理员登录 HTML 与发布前相同 |
| 线上浏览器 | 首页完整渲染，中英文标题切换，唯一 canonical，index/follow、JSON-LD；点击隐私政策后 canonical/JSON-LD 清除，noindex 保留 |
| Google | 已查看现有 Search Console 会话的属性列表，未见 moventra.me；未添加属性、未验证所有权、未提交 sitemap 或请求收录。模拟 Googlebot UA 200 不等于 Google 实际抓取或收录证据 |

后台 Worker、Render API、生产数据库、迁移、真实渠道与资金写入：本次均未执行。SEO 的 noindex 不替代现有数据授权；已登录业务验收不在本次范围。

## 下一步

在用户选定的 Google Search Console 账号添加并验证 `https://moventra.me/` 属性，然后提交 `https://moventra.me/sitemap.xml`，通过「网址检查」请求首页收录。Google 自行决定抓取、收录与排名；部署成功不代表已在搜索结果显示。

实现与操作说明见 [官网 SEO](../frontend/website-seo.md)。
