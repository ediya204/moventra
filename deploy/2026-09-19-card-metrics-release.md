# 卡片历史与指标生产发布 — 2026-09-19

## 授权与范围

用户确认三批方案：指定邮箱正式归属卡历史基线、持久化/批量指标/页面、沿用Webhook和手动补同步。基于main独立工作树实施并整合交易UI e030d88及发布记录a57f287；没有覆盖共享主目录的未提交工作。仅来源GET及查询投影，无发卡、充值、转账、调额或账本资金写入。

## 代码与部署

- 核心 b613219；运维检查点 dcaac3f；客户端加载保持修复 abf5514。均已推送GitHub main。
- Render API首次兼容部署 dep-damn86hmirbc73an9scg（b613219，开关关闭）；启用部署 dep-damn9n3m8hqs739cg4s0（dcaac3f），2026-09-18 17:30:46 UTC live。仅合并设置CARD_METRICS_ENABLED=true。
- 客户端最终Worker cbc00d28-288d-4a13-b901-1899e95ce553，26份JS/CSS与最终本地构建逐字节一致；后台Worker fc43a21f-1515-410b-b145-3920d6c6fe17，41份JS/CSS一致。保留已发布交易UI、CVV及原权限。

## 备份与迁移

- 新Render逻辑导出2026-09-18T17:24Z；压缩包SHA256 `ddcacf7bea702dee94e063cb70df69bfc3f6580a2f30abfd84a354438527b229`。保存在本机私有备份目录，不提交数据或签名下载地址。
- 本地隔离库恢复成功，运行同一定向迁移；82张既有表的完整行内容摘要迁移前后完全相同。仅新增020的查询表/当前视图覆盖和迁移记录。
- 生产定向迁移任务 job-damn94ff3r2c73ajvakg 成功于2026-09-18 17:27:52 UTC；依赖及020 checksum由迁移器和启用后readyz核验；020 SHA256 `f647e3bc347b376e9a88c4de0253d80e2a9396890ed667a70406e6578c2c48d0`。
- 本机Postgres直连受IP白名单限制、Render SSH公钥认证失败、MCP查询连接失败；未放宽权限，使用已有Render一次性任务内网执行。不是Slash白名单阻塞。

## 固定范围与真实数据

- 已核验指定邮箱为启用且邮箱验证通过的customer。plan任务 job-damn94e7bikc73bo5iug 固定23张正式归属卡，连接slash-apexis-op-trial。
- manifest SHA256 `b1d92213e2281eaa13f4a8d78ab12e44d635ea7d9466226581d431bd42569a4a`；enroll任务 job-damn9d67bikc73bo6n10 成功登记23张，输出financialWrites=false；清单仅保存私有备份目录。
- 近30天23个窗口全部完整，共8笔来源卡交易（包含不同交易状态，并非8笔全部算消费）；21张来源返回可消费额度，2张未提供。真实0和未提供分别显示。
- 23个近30天、23个更早历史、23个交接窗口共69个任务全部done，最后状态任务 job-damndlff3r2c73akhqa0 确认23张卡均complete/idle，无queued/review/error。更早历史额外获取28笔来源记录；只承诺接口返回范围，不声称无限历史保留。状态读取任务保留purpose/state/pages/records/error/from/to及runId，失败保留游标。

## 验证与限制

- 157项前端/网关回归、客户端类型检查及两端构建通过；Go vet/build与本地隔离PostgreSQL race全量回归通过。覆盖重复导入、分页失败、游标环、旧通知回查、pending到posted、退款、金额精度、越权/撤销归属、retry保留断点和不写资金表。
- 真实客户登录由用户完成MFA；尾号3475页面显示可消费额度14.85 USD、近30天消费105.15 USD；点击消费明细后同一精确UTC半开区间返回1笔OPENAI -105.15 USD，金额一致。未读取CVV或提交卡资金操作。
- readyz200；客户端未认证身份401；两端跨角色API路径404。健康检查不替代上面的真实业务验收。
- 本批未制造真实消费/退款来测试新Webhook。已有接收回查链已接入指标落库；重复/乱序/状态转换通过隔离测试。空闲worker不查询Slash，前端15秒只刷新本地数据库查询。
- 兼容回退：先关闭CARD_METRICS_ENABLED再回退程序；保留020表、观察记录与已采集来源事实，不删除表或以备份覆盖正在变化的线上账本。
