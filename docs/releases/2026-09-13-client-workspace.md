# 客户工作台一致性发布

用户明确授权“同步 发布”。2026-09-13（香港时间），仅发布客户端 Worker moventra-web。

- GitHub main：3701350 同步此前已上线但未推送的官网调整；2634c6a 为工作台一致性代码。未纳入共享工作区其他未提交功能。
- 发布隔离目录：/tmp/moventra-client-publish-20260913，从最新 origin/main 4a9edaa 克隆并按冻结锁文件安装依赖。
- 发布前重建当前线上基线，HTML、Website、AuthLayout、LegalLinks、ClientHome 与线上逐字节一致，保留 2026-09-11 移除订阅卡及首页登录注册入口的调整。
- 发布版本：824c4a74-8c33-4325-9ffb-835eb575b5e0。回退版本：2ec7f0e1-c273-45a5-993c-0b15537582d9。
- 现有域名绑定保留：moventra.me、www.moventra.me、moventra.apexisnetworking.work。
- 本次验证：完整前端/网关回归58项、咨询测试5项通过；客户端TypeScript/Vite构建、Wrangler production dry-run通过。
- 线上核验：moventra.me、www.moventra.me 的 /portal HTML 与发布产物逐字节一致；moventra.me 的 Website、AuthLayout、LegalLinks、ClientHome 资源也一致。入口 index-Bb0Mh-W2.js；工作台 ClientHome-A2TMlulO.js，SHA-256 为 f8f1fedf30f05e818975c99d015d6d32f76eebeaf8a551105136dfb692fcc1eb。
- 权限边界：无身份 /api/v1/me 返回401，/admin-api/v1/ops/overview 和 /local-slash-demo/state 返回404。没有执行登录、资金或渠道写操作。
- 浏览器：上一轮独立夹具已检查桌面布局和设置跳转；本轮发布后浏览器连接服务异常，未重新完成浏览器及本人认证后的业务验收。资源核验不等同真实业务验收。
- 后台 Worker、Render Go API、数据库迁移和真实金融渠道：均未执行。本次不将 Demo 数据或写功能带入正式客户端。

设计及实现边界见 [工作台流程卡](../frontend/client-workspace-parity.md)。原共享工作区相关源码与发布文件逐字节一致，保留其旧本地分支及无关未提交改动；发布提交通过独立目录推送 main，不强行合并覆盖共享工作区。
