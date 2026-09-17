# Blnk 私有服务与共享 PostgreSQL 实例（2026-09-18）

## 最终拓扑

用户要求部署 Blnk，并明确希望数据库共用一个实例。复用既有 `moventra-postgres`，Blnk 使用其中新的逻辑数据库和受限登录；不再新增付费 PostgreSQL 实例。

| 资源 | 实际标识 | 用途 |
| --- | --- | --- |
| 既有 PostgreSQL | dpg-daepg09t0dsc73b7q55g-a | basic_1gb / 20GB / PostgreSQL 17；保留原业务库，新增 moventra_blnk 逻辑库 |
| Blnk Core | srv-dam1an2jnfac73cuooj0 | Singapore / Starter 私有服务，内网 http://moventra-blnk:5001，无公网 URL |
| Redis 兼容服务 | red-dam19267bikc73fuvomg | Singapore / Starter，noeviction，journal_snapshot，公网 allow-list 为空 |

Blnk 角色 `moventra_blnk` 不具备 SUPERUSER、CREATEDB、CREATEROLE、REPLICATION；连接上限 15，Blnk 连接池上限 10。数据库 TLS 使用 require。API 开启 secure 模式及独立随机密钥，metrics 使用另一个密钥，遥测关闭。密钥只进入 Render 运行环境，不提交仓库。

曾创建的新 PostgreSQL `dpg-dam18u0ae00c73cnktv0-a` 未接入应用或写入业务数据，已删除；最终云端列表只有原 Moventra PostgreSQL 实例。新资源基础月费约 $17（Blnk $7 + Redis $10），不含按量项目和未来存储增长，参考 [Render pricing](https://render.com/pricing)。

## 配置与初始化

- [配置](../../deploy/blnk/render.yaml) 经 Render Blueprint 校验；资源通过 API/CLI 管理，没有新建 Blueprint 自动同步。
- Blnk 版本 0.15.4，OCI index digest `741665b0d7d5a1c6dc0a989aacf249c05637c52dcf96163c67f9d7a7010ec22d`；Render linux/amd64 实际 digest `a2287892105a29a3b900f51d4b1d37cec8048d4471e46c43d7c257cbf7bf5447`，与 manifest 核对一致。
- 初始化先创建独立逻辑库/受限账号，然后运行 Blnk 自身迁移。PostgreSQL 17 指定数据库 owner 需要创建者能 SET ROLE；初始化临时成员关系已撤销。
- 修正了 Render 复杂命令引号解析和 Blnk 0.15.4 忽略 --config 参数的问题；最终启动为 `blnk start`，使用 BLNK_* 环境变量。
- 初始化完成后清空 preDeployCommand，移除 bootstrap 脚本/SQL/高权限连接配置。自动部署关闭。

## 验证范围

- 首次 Blnk 成功部署 `dep-dam1c60ae00c73co1nqg` 已 live。
- Moventra API 一次性任务 `job-dam1d10u01pc73b4hseg` 内网访问 Blnk `/health` 成功，返回 `{"status":"UP"}`。
- 现有 API `/readyz` 返回 `{"status":"ready"}`，业务表结构未修改。
- 重启部署 `dep-dam1dcfcgkoc73fvng80` 已 live；preDeployCommand 为空，未再次初始化数据库。
- 检查任务 `job-dam1dqtbedkc73aae6pg` 的 HTTP/SQL 断言全部通过：无密钥 401、有密钥读取 general_ledger_id、连接数据库/用户均为 moventra_blnk、blnk schema 19 张表、角色无高权限、原业务库可 SELECT/INSERT/UPDATE/DELETE 的表为 0。该任务最后的 verify-chain 因探针遗留 PGSERVICE 环境被 pgx 拒绝而退出；随后单独任务完成验证。
- 独立校验 `job-dam1e6oae00c73co9hd0` succeeded：交易哈希链校验通过，0 笔交易，未导入或伪造用户资金。
- 临时探针文件已从配置删除，最终清理部署及确认见下方。

本轮没有执行 Moventra 应用迁移 006，也没有启用应用 LEDGER_MODE、创建真实客户账本、导入期初或执行 Slash/Cregis/链上资金动作。Blnk 服务部署完成与真实记账切换是两个状态。共享 PostgreSQL 实例会共享容量与故障域；逻辑备份/恢复须覆盖两个数据库。

最终清理部署 `dep-dam1e7ijnfac73cv5750` 已 live（UTC 16:37:12）。服务启动命令为 `blnk start`，一次性 pre-deploy 为空，临时 Secret Files 数量为 0；运行所需独立凭据保存在 Render 环境变量中。
