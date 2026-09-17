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
