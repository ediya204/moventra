# 首页账户入口移除（2026-09-11）

用户要求删除首页登录注册，沿用本会话官网部署授权。首页顶部、移动菜单、咨询区域、页脚账户链接已移除；登录、注册和密码找回页面及路由保持。精确同步正式源码及旧本地预览文件。

独立发布目录 /tmp/moventra-remove-subscription-20260911；本地提交 1cfb08d，未推送 GitHub。客户端 TypeScript/Vite 构建、5 项咨询测试及 Wrangler dry-run 通过；官网 HTML 和 Website JS 与产物字节一致，线上浏览器确认首页无账户入口。

Worker moventra-web：2ec7f0e1-c273-45a5-993c-0b15537582d9；可回退前版 61d4daae-d3bc-42bc-9467-71f96dbb3dff。仅发布官网；未发布后台、API 或数据库，未发送测试邮件。
