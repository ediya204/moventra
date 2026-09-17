# 后端运行优化发布

目标项目：prj-daep4m8n74is73es7g1g / moventra-card-bin / Production；服务 srv-daepgj8u01pc73fgdhsg / moventra-api。用户本轮明确授权部署并提供项目 URL。

## 发布候选

基于最新 origin/main bdb7c7f，在独立 codex/runtime-release-20260918 worktree 适配；原工作区的其他修改保留。连接池参数、就绪检查、Worker/ledger 观测工具及相关测试/文档为本次范围，前端和现有渠道/用户功能沿用 main。

就绪检查使用 main 的 001–005 checksum，ledger 启用时核验 006，修正旧本地工作区编号差异。没有新增或修改迁移 SQL；不执行生产迁移。镜像包含 api/ledger/worker，默认 api；worker/status 仍为本地隔离 shadow 工具，不启动云端记账服务或启用生产账本。

## 本次发布前验证

- Go vet/build 通过。
- test-blnk.sh：真实本地 Blnk + 隔离 PostgreSQL race 回归通过，包含 Worker 自动消费/幂等、队列状态隔离和错误拒绝。
- test-runtime-restore.sh：合成应用数据库 dump 校验、逐表恢复、迁移校验、审计保护通过。没有演练生产或 Blnk 存储恢复。
- test-worker-runtime.sh：实际 status CLI、JSON 观测、连接池配置、SIGTERM 退出通过。
- Render 项目环境 ID 与目标 API 环境一致；自动部署 off、preDeployCommand 空。
- 发布前线上基线：524b9989cb7dd0e65b1c95c5d535410988f1101c，deploy dep-dam1fju7bikc73fvn1jg，live。作为本次回退参考。

部署结果另在完成后补充，不将构建或预检当作线上业务验收。

## 已完成发布

- GitHub main 已包含运行源码 `8bfc0b5c9c323fde5722450e24ace45217353676`。
- Docker Linux/amd64 构建通过；容器 UID=10001，api/ledger/worker 三个程序存在且可执行，默认入口仍为 API。
- Render deploy `dep-dam1melbedkc73abet4g` 于 2026-09-18 00:55:56 香港时间变为 live；运行提交为上述 8bfc0b5。
- 新实例日志确认 `api listening port=10000`。
- 发布后 `/healthz`、`/readyz` 为 200；无凭据访问双端 me、运营 users 与 channel-projections 均为 401；全部保留 Cache-Control: no-store。
- 本次未部署前端、未变更 Blnk/Valkey、未修改云环境变量、未执行数据库迁移或真实金融操作；未新增云端 Worker，不宣称生产队列监控已经启用。
- 真实 Firebase 登录、已认证业务流程与渠道资金验收未执行；以上是版本、运行与未认证边界验证。
- 原工作区保持未提交状态；本次代码从隔离 worktree 发布，不重置旧本地 main。
- 启动后观察至 00:58:02 香港时间：目标实例 error 级应用日志为空；再次读取 /readyz 为 200，最新部署仍为本次 live。短窗口无错误不等于长期性能/业务验收。
