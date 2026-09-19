# 换电脑继续开发

2026-09-19交接。项目为ediya204/moventra，统一main。先读根AGENTS.md、开发总纲、当前状态、[全会话交接](session-handoff-2026-09-19.md)及对应子项目README；新电脑以实际clone路径为准，不依赖旧Mac目录或/tmp中的发布工具。

## 获取代码与启动

准备Git、Node.js 22+、pnpm 10.32.1。后端开发另需Go 1.26.5与本地PostgreSQL。仓库权限使用自己的GitHub登录。

```bash
git clone https://github.com/ediya204/moventra.git
cd moventra
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev:client
# 另一终端，从仓库根目录运行
pnpm dev:admin
```

客户端127.0.0.1:8853，后台127.0.0.1:8850。两端正式API默认代理本机8870；仅启动前端不会自动得到可登录的本地后端。后端环境变量参考services/api/.env.example，按[API运行说明](../../services/api/README.md)配置独立开发数据库、Firebase服务身份并启动；命令不自动加载dotenv。只在新建本地开发库运行全量迁移，不对生产库执行。API不会自动授予用户或运营权限。

不需要复制node_modules、dist、Go构建产物或旧/tmp文件。公开Firebase网页配置已在源码中；服务账户、渠道密钥、私有CA和数据库口令不在Git里。需要后端联调时通过既有安全配置管理取得开发配置，不把生产密钥写入VITE变量或提交到仓库。

## 验证

```bash
NODE_OPTIONS=--experimental-strip-types pnpm test
pnpm typecheck
pnpm build
pnpm docs:check
# 配好本地PostgreSQL后运行，脚本自建随机隔离测试库
bash services/api/scripts/test-postgres.sh
```

首次后端依赖可在services/api运行go mod download。Blnk及金融专项测试另按对应专题准备隔离服务，不以生产资金完成开发测试。

## 线上与发布

- 客户端：https://moventra.me；后台：https://admin.moventra.me。
- 两端Cloudflare Worker分别为moventra-web、moventra-admin；API为Render moventra-api（srv-daepgj8u01pc73fgdhsg），根目录services/api。
- f59ad8f是历史会话保持修复，不能继续作为当前部署基线。后续63371c7已发布API、发卡Worker及两端前端，023备注迁移完成，精确版本见[统一发布记录](../../deploy/2026-09-19-consolidated-ui-release.md)；更晚单张开卡任务状态见[全会话交接](session-handoff-2026-09-19.md)。文档提交不改变已部署产物。
- 云端服务、生产数据和平台环境配置不会因换电脑中断。新电脑需要重新登录GitHub、Cloudflare和Render；不依赖旧机CLI会话。Wrangler使用deploy/cloudflare内锁定版本，先npm ci --prefix deploy/cloudflare再调用其本地CLI。
- Render自动部署关闭；推送main不等于上线。两端使用各自Wrangler配置，部署需保留平台变量。发布入口见[部署说明](../../deploy/README.md)。

## 继续工作的边界

卡片生命周期已采用命令、Webhook单卡回查与手动核对，不恢复五分钟全量轮询；注销保留历史。真实卡片启停/注销未实操验收。每卡10 USD目标未由状态同步设置。卡片详情及按需CVV已有[后续发布证据](../../deploy/2026-09-19-card-detail-cvv-release.md)，不能再按早期纯设计描述；通用卡充提及存量卡期初接管仍未完成。

正式TRC20充值与OTC、提款/卡充提/真实发卡分别有独立启用边界，以[当前状态](../current-state.md)及[资金激活记录](../../deploy/2026-09-18-production-funds-activation.md)为准。客户端刷新保持登录已发布，但真实用户登录后刷新仍待浏览器验收；自动化不替代本人登录结果。

部分历史任务仍有未合入main的独立工作树，例如存量卡期初ddfac22。仅clone main不能恢复这些分支或未提交文件；接手前按全会话交接定位原任务，核对差异与已有授权。用户暂停的客户端联调检查保持暂停。不要将旧预览端口、临时脚本和历史测试结果当作新电脑已经验证的环境。
