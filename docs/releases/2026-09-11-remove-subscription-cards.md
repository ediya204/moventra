# 官网移除订阅卡（2026-09-11）

用户授权删除并部署。基于最新 origin/main 4a9edaa 在独立目录 /tmp/moventra-remove-subscription-20260911 构建，本地发布提交 0caa122；未推送 GitHub。正式共享源码已同步精确改动，保留其他未提交工作。

官网服务、对应场景、FAQ、页脚、公开认证布局及中英文服务条款移除订阅卡，服务卡片桌面改为三列。咨询表单沿用原接口编号 0/1/3/4，避免云服务与组合方案错位；网关兼容既有请求，未发送真实测试邮件。

验证：两端 TypeScript/Vite 构建通过；pnpm test 54 项通过；咨询表单测试 5 项通过，新增服务编号映射覆盖；Wrangler production dry-run 通过。浏览器线上中英文均仅显示广告营销、AI 订阅与云服务。moventra.me 与 www.moventra.me 的 HTML、Website、AuthLayout、LegalLinks 文件逐字节匹配本次构建。

仅发布 moventra-web，版本 61d4daae-d3bc-42bc-9467-71f96dbb3dff；上一版本 02572561-3a98-4fc4-b9f7-4587299dadac 可回退。未发布后台 Worker、Go API，未迁移数据库或调用真实金融接口。后台构建仅用于共享模块兼容检查，不代表后台已部署。
