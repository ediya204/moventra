# 2026-09-18 main 合并核对

用户授权：检查并合并可取得的未合并代码，以线上最新版本为基线。原始 main 为 `89ca9c3`。本次没有获得部署、生产迁移或实际资金执行授权。

## 实时核对

- Render `srv-daepgj8u01pc73fgdhsg` 最新 live 部署为 `dep-damcd0v40ujc73addftg`，提交 `a2fa1f658317a369be47cc57e850ebb3ca5678e1`，autoDeploy=no。
- origin/main `89ca9c3` 已包含线上 API 提交，后续差异为发布文档。
- 当前线上后台加载 `/assets/index-BM8FRtXe.js`，此前本轮已核实其仍使用内存认证配置。
- 本机仓库只有一个 worktree；fetch 后远程仅 main 和 `codex/website-seo-production`。GitHub 无开放 PR。

## 合并清单

| 来源 | 核对结果与处理 |
| --- | --- |
| SEO 分支 `41c01f1` | 与 main 对应业务源码、构建配置、网关、测试逐文件 blob 相同；仅 README、专题发布状态和 package.json 后续增量不同。main 已有 `499f891` 对应实现，保留 main 更新内容并合并分支历史 |
| 本轮会话修复 | 后台 SESSION、客户端 NONE；恢复后仍执行 Go 准入。见[验收记录](../business/admin-session-persistence.md) |
| 本轮财务入口 | 卡费率管理、USD 投影报表接通已有接口；剩余模块未接通，见[流程卡](../business/admin-finance-migration.md) |
| 文档整理任务 | 当前状态/历史快照分离、Harness 与离线文档检查脚本；纳入审查与合并，不丢弃历史记录 |
| 用户归属显示任务 | 用户确认原显示正确，该任务已撤回，没有功能增量要合并 |
| Cregis、商户目录、Slash 生命周期、shadow sources/financial 候选 | 发布记录提及未合入，但当前仓库、远程分支和本机相关目录中未找到 Moventra 候选源码；无法凭文档重建或宣称已合并。已请求用户提供另一台电脑/仓库的位置 |

其他项目中搜索到的 Cregis 同名文件不视为 Moventra 候选，不跨项目复制业务、配置或凭据。历史候选迁移编号可能与线上重叠；取得源码后须按当前数据库迁移重排，不能覆盖已应用 SQL。

## 交付状态

已审查当前可取得的代码与文档增量；两端类型检查/构建、112 项前端/网关测试、12 项 SEO 测试和 125 份 Markdown 检查通过。合并使用 main 的最新文件内容；SEO 历史合并不改变文件树。生产部署、数据库迁移、真实金融操作未执行；本记录不表示所有“待迁移”功能已完成。
