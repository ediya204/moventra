# 会话修复上线与换机交接

用户要求将main部署线上并换电脑继续开发。源提交f59ad8fa3003aa0e71501f18e6e3abf921619250：客户端由内存身份改为标签页会话保存，刷新后仍等待Go授权；后台会话策略不变。无API业务改动、数据库迁移、卡片状态或金额修改。

## 发布与验证

- 客户端Cloudflare moventra-web：9b46c180-be03-4102-9e0f-d454b7cd47f4，正式域名moventra.me、www.moventra.me及原过渡域名。
- 后台Cloudflare moventra-admin：4f038739-dec5-47d1-a38d-14e15bbf4b4a，admin.moventra.me及原过渡域名。
- API现场查询为859dda31e6e47dcc3eedf8319cb862f1ab710036、dep-damlle1q582s738pu8v0 live；比较至f59ad8f只有API文档变化，故未重启或重部署API。
- 本会话上一轮136项前端/网关测试、两端typecheck/build与文档检查全部通过，产物对应本次源代码；本轮两端Wrangler dry-run及正式部署成功，保留平台变量。
- 线上核验：两端卡片入口HTML引用的JS/CSS与本地构建逐字节匹配，healthz/readyz 200，未登录卡片actions 401，跨端API 404。
- 实际Firebase用户登录后刷新未验收；本轮不调用金融写接口。回退可恢复各Worker前一版本，API与数据库无本批回退项。

[换电脑继续开发](../docs/harness/new-computer.md)说明获取main、环境依赖、启动、权限与待验收项。密钥及本地私有数据不进入仓库。
