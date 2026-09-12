# 正式后台与本地布局统一

日期：2026-09-13。FLOW-ADMIN-WORKSPACE-01。本地实现，未部署。

## 差异与兼容方案

截图的完整侧栏来自 DEV DemoApp；正式 OperationsPage 和 ChannelTransactionsPage 原来各自使用简单顶部导航。统一复用 DashboardLayout，保留本地主题、Logo、六组导航、搜索栏、移动抽屉及主容器。production 参数选择正式导航能力和环境标识，不加载 DemoApp。

开户审批保留已上线的正式服务与独立客户授权；其余客户维护、BIN、卡控制、财务写操作尚未接入。其菜单保留位置并明确“未接入”、禁止点击；不复制模拟指标，不将 UI 一致声称为业务能力一致。正式管理总览继续显示原有授权运营统计；渠道交易继续读取原有导入投影。

另恢复本地 App 中缺失的 /transactions、/cards/:id 路由和 liveApi 中缺失的渠道读取白名单。渠道连接为空时结束加载并显示授权提示。联合版本基于 GitHub main 399b6f9，完整保留已上线渠道和开户模块。

## 流程卡

| 项目 | 本轮范围 |
| --- | --- |
| 目标/环境 | 运营人员在本地正式布局预览中查看总览、进入卡交易与关联卡片；待合并发布 |
| 基线 | /Users/edi/Documents/ChatGPT/moventra，发布基线 399b6f9；隔离整合目录 /tmp/moventra-joint-release-20260913；共享目录未覆盖 |
| 页面关系 | /workbench → /transactions → /cards/:id?connection=... → /transactions；身份入口 /session?security=1 |
| 业务身份 | 沿用现有连接 ID、交易 ID、卡片 ID，不创建映射或客户归属 |
| 数据依据 | 正式页面依赖既有 Go 只读投影；视觉验收使用隔离空连接夹具，不查询真实业务数据 |
| 接口链 | liveGet → 同域 /admin-api/v1/ops/overview 或 /admin-api/v1/channel-projections → 已发布网关/Go；登录改动与已上线网关/Go已整合 |
| 动作与恢复 | 导航、查询、刷新、查看详情；未接入菜单禁用；无连接显示提示；读取失败不制造数据 |
| 跨端变化 | 不涉及客户端业务变更或共同资金写入 |
| 权限 | 保留 authenticated + operator + MFA；客户端 transport 拒绝 admin 路径；只读 GET，不扩张服务端数据授权 |
| 验收 | 联合回归 67 项通过；两端类型检查/正式构建通过；已认证真实交易业务验收未执行 |
| 待定 | 登录整合完成；生产 004 迁移需明确授权，发布顺序见联合记录 |

## 本次证据

参阅[联合发布记录](../releases/2026-09-13-admin-login-joint.md)。后台新增正式 `/onboarding` → `/onboarding/:customerId`，使用相同布局并保留已有审批处理。历史 8857 空数据夹具只用于布局检查，不属于发布产物。
