# 客户端开卡结构生产迁移 — 2026-09-18

## 授权与实际范围

用户本次明确要求执行生产迁移，并指定 Render 项目 `prj-daep4m8n74is73es7g1g`。本次仅应用客户端开卡新增迁移 `014_issuing_checkout.sql`，不发布应用、不启用 issuing-worker、不执行真实扣款或发卡。

目标为 My Workspace / moventra-card-bin / Production：API `srv-daepgj8u01pc73fgdhsg`，数据库 `dpg-daepg09t0dsc73b7q55g-a` 的 `moventra`。实时核对 API 仍为 `c5ff2c629ee6298093b74dcb19aa450818d9d603`，部署 `dep-damf0mdbedkc73bguksg`。源码工作区含其他任务修改，未批量提交或部署。

## 备份与演练

- 通过已登录 Render Web Shell 的私网连接操作；数据库外部访问限制未改。连接器只读查询失败后切换维护终端，没有放宽白名单或导出凭据。
- 官方 Alpine PostgreSQL 17 客户端解压至服务临时目录，未替换运行镜像。
- 生产数据库约 18 MB。迁移前逻辑备份 SHA-256：`75cf79f3d9ca89cb98e982b97f118d483f65f7c8aec06298e1489827f1376d8c`。
- 备份成功恢复至同实例隔离数据库 `moventra_checkout_restore_20260918_145`；在该恢复库执行同一脚本成功。演练库随后已删除。
- Render Recovery 同时新建平台保留备份，页面显示香港时间 **2026-09-18 17:44**，导出文件可用；平台提示至少保留 7 天。没有将带签名的下载链接写入仓库。
- 本地定向迁移回归通过：依赖校验冲突回滚、结构新增、重复执行不改迁移时间、014 冲突拒绝、排除无关迁移。命令：`python3 services/api/scripts/test-issuing-checkout-migration.py`，使用新建本地 socket 测试库，结束后删除。

## 执行结果

生产迁移 **2026-09-18 09:47:27.889373 UTC（香港 17:47:27）** 提交成功。新增不可变 `issuing_consents`、报价 `terms_version` 与订单 `retry_count`；没有补造历史同意证据。

- 定向脚本由 [生成器](../services/api/scripts/issuing-checkout-sql.py) 生成，SHA-256：`2dbefd1b7490faa186ff3b3c46ee77a70fc2f256765e3aabaf7f0ab8f3e58269`。远端执行前比对一致。
- 014 原始迁移 SHA-256：`43f2e9df26d59cbfc6b67721d1bcc1dc7534467d7c34480b81b821c4d3f6ab9c`。
- 既有 1–5、7–12 校验值全部一致；006 仍未应用，013、015 未应用。本次没有调用全量迁移器。
- 18 张原有 issuing 表以及 accounts、transactions 共 20 张表的行数/排序 JSON 内容摘要在执行前后完全一致；排除本次新增的两个默认字段。校验文件 SHA-256：`81428281ecd05b98c6ad0022ee884f42ce6e22164e1c3903fdf29a911d7f6cb6`。
- 复查：8 个产品仍为 draft，订单 0，同意记录 0，ISSUING_MODE 未设置；订单重试次数默认 0，旧报价条款版本默认空字符串。
- 迁移后 `/healthz`、`/readyz` 均 HTTP 200。

## 当前交付边界

设计及本地业务实现见 [客户端开卡闭环](../docs/business/client-card-issuing.md)，隔离测试证据保持原日期语义。本次新增验证为定向迁移回归、真实生产备份恢复演练、结构迁移和服务健康检查；没有重新执行完整业务浏览器验收。

**生产结构已迁移，开卡应用代码与独立 Worker 尚未发布；真实渠道金融写入未执行。** 真实扣款/发卡需操作者亲自提交，且不能将草稿产品、未配置商业价格或未验证的账本能力视为已可用。

兼容回退：现行 API 继续运行；保留新增表与字段，不删除同意证据、不反向修改金额。确需恢复数据时应另行确定恢复时间点和影响范围，不能直接以旧备份覆盖正在产生的新数据。
