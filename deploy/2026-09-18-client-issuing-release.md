# 客户端开卡与八个 BIN 目录发布

日期：2026-09-18。FLOW-CLIENT-ISSUING-001，基线 `1ed842a`，独立发布目录 `/tmp/moventra-issuing-release-20260918`。用户授权部署及八个 BIN 基础配置，并明确开卡费 10 USD、最低首充 20 USD。

## 本批内容与流程

正式客户端申请入口、产品及条款、费用确认、声明、订单/新卡稳定路径；共享 transport、同域网关、Go handler、独立 issuing 初始化、持久化 Worker 二进制以及运营同单核查。完整前后端链、权限和异常恢复见[流程卡](../docs/business/client-card-issuing.md)。修正 ClientHome 的订单/新卡深链白名单并补回归。排除并行 Cregis 资金开发及迁移013/015；原工作区保留。

014 已先行[迁移生产](2026-09-18-issuing-checkout-migration.md)。本发布迁移器采用显式版本列表，保留013空位；生产发布过程不执行全量迁移。

## 产品基础配置

BIN：40024200、40041606、40041641、43612077、43612078、43612079、43612080、43612081。

统一命名 Moventra USD · BIN，USD 虚拟卡，开卡费1000分、最低首充2000分，最低合计30 USD。描述不承诺特定商户、国家或库存。2026-09-18 从现有 Render 私网环境只读 GET `/card-product`，返回全部8个active产品且没有nextCursor，与导入映射一致；没有渠道写请求。

卡组织按来源BIN的4开头规则归类Visa，属于内部派生，非Slash card-product返回字段。依据：[Visa商户识别指南](https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/acceptance-for-quick-service-restaurants.pdf)；[Slash产品接口](https://docs.slash.com/api-reference/card-product-get)只给id/prefix/status。

配置脚本[issuing-catalog.sql](2026-09-18-issuing-catalog.sql)锁定目录、校验8条精确来源及revision=1，原子记录配置前后审计。维护控制台操作的actor_id为空，executionContext明确记录，不冒充某位登录用户；不新增运营权限或改变MFA。审计失败回滚，重复执行不重复更新。脚本SHA-256：`78b0d3843933e00fd252a7f92f95ea8b58c44e9f013a884d08d5231e0f707761`。

## 本次验证

- 独立候选前端/网关/契约116项通过，两端typecheck/build通过，保留既有chunk体积提示。
- 新建本机PostgreSQL全量Go race、go vet及命令构建通过；真实Firebase/Blnk条件测试按自身环境开关跳过，先前隔离浏览器证据不改日期。
- 目录脚本隔离测试通过：精确基线、漂移拒绝、审计失败回滚、价格10/20、幂等、供应商和资金不变。
- 站点SEO和联系表单额外17项测试通过；文档检查通过（129篇、868个链接）。
- 生产目录配置于09:59:06 UTC（17:59 HKT）提交，8个产品均为active、revision=2、价格1000/2000分；审计1条、供应商仍暂停、开卡订单0条。
- 生产28项HTTP探测通过：healthz/readyz 200，两端及直连API的新查询路由未登录均401，页面深链200，6份JS/CSS与本地构建逐字节相同。HTML最初逐字节比较失败，检查差异仅为Cloudflare追加的现有analytics脚本；精确移除该脚本后5个HTML均与构建一致。
- 正式浏览器两端均跳转各自登录页、无控制台错误；没有可用本人会话，未执行生产登录后业务验收，未将隔离身份注入生产。

## 当前上线边界

真实生产检查发现ISSUING_MODE、独立ISSUING_BLNK_URL/KEY及供应商验收清单均未配置。8个产品可配置为公开目录，但供应商仍暂停，支付应由服务端拒绝。不能伪造零限制/累计限制、未知结果恢复、对账及会计验收记录来打开执行开关。

正式可支付仍需实际独立账本配置、持有人及渠道限制/恢复/对账证据、运营财务接收、客户开卡资格与可证明的入账余额。真实扣款/发卡由操作者亲自提交；当前不是“真实开卡已经验收完成”。本批不产生真实金融订单。

应用回退到前一版本保留014及审计；目录可按审计before快照恢复，但须再次核对版本和订单情况，不直接覆盖后续运营修改。

## 发布执行记录

代码 `92cad848384799c7c666e3e4879227b0c049566f` 已推送并与 GitHub main 核对一致。Render API 发布 `dep-damgot740ujc73asrdgg` 于10:03:32 UTC触发，自动部署关闭、preDeploy为空；不运行其他迁移。API于10:05:17 UTC（18:05 HKT）变为live，确认运行上述代码；镜像包含issuing-worker二进制，但未创建/启动生产独立issuing-worker服务。

| 服务 | 本次线上版本 | 结果 |
| --- | --- | --- |
| Render API | `dep-damgot740ujc73asrdgg` / `92cad848384799c7c666e3e4879227b0c049566f` | live、两项健康检查200 |
| 客户端 moventra-web | `b35d97a0-d1f4-4d19-84c1-979dda71fd38` | 已发布，正式与兼容域名保留 |
| 运营后台 moventra-admin | `1c3e82a5-bed0-49ed-b44e-f2afecf782b0` | 已发布，正式与兼容域名保留 |

客户端地址 https://moventra.me/portal/cards/new ，后台 https://admin.moventra.me/card-bins 。两端由92cad84独立构建，发布保留已有Worker变量和绑定；后续文档提交不改变线上运行代码。
