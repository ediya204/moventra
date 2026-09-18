# 生产全局管理员

2026-09-19，FLOW-AUTH-GLOBAL-001。用户明确要求指定运营身份管理所有现有及未来客户、渠道及后台配置。实现基线 main `5e55451`；本批隔离于并行客户端页面改动。发布与实际授权状态见下方证据，不以本文件存在推定完成。

## 流程卡与权限模型

| 项目 | 本批范围 |
| --- | --- |
| 起终点 | 受信运维核验指定 Firebase 邮箱/UID → 既有 active admin → 全局授权 → 本人后台登录及 MFA → 查询/配置实际业务资源 |
| 页面 | `/admin/login`、`/workbench`、客户/卡片/渠道、BIN、资金与配置原有页面；后台账号旁标记超级管理员 |
| 接口链 | AuthContext → 同域白名单 → Go authenticate → PostgreSQL effective scopes → 原业务 handler/审计；`me.globalAdmin` 仅为显示字段，不接受调用方声明 |
| 身份 | users.role 保持 customer/admin；global_admins 记录用户 ID、证据及授权时间；无邮箱硬编码、无 Firebase 自定义声明旁路 |
| 动态范围 | effective_staff/channel/ledger/issuing/manual 授权视图与按运行 namespace 查询的 crypto 函数；未来客户及已登记渠道自动覆盖，既有逐对象授权原样保留 |
| 权限列表 | 客户账户/交易/开户审核、渠道投影及卡控制原权限、账本只读、BIN/供应商/价格/资格、开卡到账提交复核及恢复、crypto 查询/审核/配置/恢复、来源读取/同步、manual 查询/创建/复核/执行 |
| 状态约束 | 全局身份不越过 MFA、客户生命周期、幂等、审计、资金双人复核或渠道执行开关；不开启尚未验收的提款/卡充提/发卡，不新增实际订单或余额 |
| 混用和撤销 | 授权拒绝客户所有者/企业成员；有效视图也排除混用身份；停用/降级失效，撤权不删除原 scoped grants；已开始的事务按原隔离级别结束，后续请求重新核验 |
| 审计 | grant/revoke 与 global_admin_audit 原子提交，重复执行不重复审计；审计不可修改或删除；读取/配置动作继续进入原模块审计 |
| 跨端 | 超级管理员仍不能进入 client-api；普通管理员和客户范围不扩大。旧测试资金保持生产屏蔽，不因全局身份开放 |
| 待验证 | 指定用户本人真实登录/MFA及全模块浏览器流程需独立验收；大规模客户范围发现和分页限制沿用原接口，不承诺无限量 |

## 运维

新增 `019_global_admin.sql` 只新增权限表、函数和视图，无角色回填、余额写入或原 grant 修改。先做生产导出、校验和、隔离恢复与迁移演练；生产用 `python3 services/api/scripts/global-admin-sql.py` 生成精确 SQL，经受控任务执行。依赖001–018 checksum必须一致，重复019只校验不重建。不得全量迁移生产库。

API就绪检查要求019。兼容顺序：先安装019 → 部署API → `api global-admin-plan <邮箱>` → `api global-admin-grant <邮箱> <授权依据>` → 回读 → 发布后台显示。命令每次通过 Firebase 解析真实邮箱/UID，授予时要求邮箱已验证、未禁用且已绑定MFA，数据库须为active admin且无客户身份。无公共HTTP授权入口。

撤权：`api global-admin-revoke <邮箱> <依据>`；保留原逐客户/渠道授权及审计。回退旧API前先撤销本次全局权限；无需删除019表或回滚业务数据。各应用版本、配置和未完成验收分开记录。

## 本批验证与发布

本地隔离回归已覆盖：未来客户/渠道、各模块配置范围、客户拒绝提升、MFA/跨端拒绝、撤权恢复原范围、重复授权、审计失败回滚、019 checksum冲突；人工资金完整状态机在全局管理员下复跑，禁止自审及幂等保持。136项前端/网关回归、两端typecheck/build、Go隔离PostgreSQL race、vet/build及后台Wrangler dry-run通过；生产备份 SHA256 `77d196e7ccd30a85386f41622bef354694a98538bc479f0ae37520c5f3ce6df7` 已在本机独立恢复并完成019及重复执行演练。生产019、授权或本批部署完成后追加精确记录。
