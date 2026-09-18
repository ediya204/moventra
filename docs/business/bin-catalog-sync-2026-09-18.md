# FLOW-BIN-CATALOG-01：Slash 目录同步与正式 BIN 管理

本次发布范围：后台供应商、BIN 产品、三级价格配置和来源目录导入。基线 origin/main c283b71，隔离工作区 codex/bin-catalog-sync-20260918；原工作区未提交改动保留。

流程：Render 已放行出口 GET /card-product → 完整分页脱敏证据 → issuing-admin import-catalog → PostgreSQL 012 → 后台 /card-bins → 独立详情与审计。后台 transport → Cloudflare gateway → Go /admin-api/v1/card-issuing，管理员 MFA 与独立 catalog:read/write、pricing:write 权限由后端检查。供应商、产品和客户覆盖价使用稳定内部 UUID，来源产品按 supplier_id/upstream_id 隔离。

真实来源：2026-09-18 Render job-dambc40u01pc73f1nutg，1 页8条，nextCursor 耗尽。这是当前试运行凭据可见目录，不声称 Slash 全球产品全集。原始证据见 ../integrations/evidence/slash-card-products-2026-09-18.json。网络卡组织、商业价格与最低首充不是该接口返回事实，首次导入保持未配置。

同步事务创建暂停供应商和草稿产品。重复同步复用内部 ID，保留商业配置与上下架状态，记录来源状态、时间、证据及不可改写审计；来源前缀变更、倒退快照、重复产品 ID、分页未完成、无独立权限均拒绝。缺项不删除已有产品。来源 inactive 阻止新申请资格。来源映射不可直接改绑。

空价格表示未配置，显式0表示免费；产品上架必须配置卡组织、开卡费、正数最低首充。客户覆盖价清空恢复继承。修改商业金额需要 pricing:write，产品状态管理需要 catalog:write。供应商/产品暂停只针对新申请，目录操作不调用 Slash 金融写接口。

本次附带前期独立发卡模块代码和契约用于后续接入，但生产 API 不初始化真实执行 Service，不部署 issuing-worker，不授予入账和恢复权限，不启用真实钱包、首充或发卡。客户端原有已上线功能不被替换。真实开卡、实时渠道池对账、Blnk生产配置及渠道限制验证仍未验收，不把本次目录上线称为真实开卡闭环。

迁移012是新增文件，已应用001–011文件保持不变。迁移自带审计不可变函数，不依赖生产未启用的shadow迁移006。生产实施前新备份、SHA-256校验、独立恢复和旧资金表不变量验证；回滚应用保留新增目录和审计，不删除资金或来源证据。

验收：隔离 PostgreSQL测试涵盖全流程与导入重复、空值、保价、改绑拒绝、权限拒绝、审计失败回滚；前端测试涵盖正式路由、网关与供应商操作。实际运行结果和发布证据记录在 deploy/2026-09-18-bin-catalog-sync.md。
