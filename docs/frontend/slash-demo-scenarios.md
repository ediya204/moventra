# Slash Demo 场景、记录ID与预期金额

固定namespace `slash-clearing-v1`，seed `20260906`，R001为首套20场景。所有金额为USD，负净额表示支出。每个场景期初1000.00 USD；最终posted=期初+净额，available=posted−剩余冻结。净额包含单列的内部Demo调整。

交易ID以下完整列出；同场景账户/卡/虚拟账户ID分别为 `DEMO-SLASH-Sxx-R001-ACCOUNT` / `-CARD` / `-VA`。来源事件和每个历史版本可在交易详情下方查看。

|场景及入口|交易ID|预期净额|冻结|说明 / 确认边界|
|---|---|---:|---:|---|
|[S01-R001 正常授权后全额清算](http://127.0.0.1:8852/transactions?scenario=S01-R001)|`DEMO-SLASH-S01-R001-T1`|-100.00|0.00|授权100，入账100；释放全部冻结。 Demo规则验证|
|[S02-R001 授权100，清算80](http://127.0.0.1:8852/transactions?scenario=S02-R001)|`DEMO-SLASH-S02-R001-T1`|-80.00|0.00|授权100，最终支出80；释放多冻结20。 Demo规则验证|
|[S03-R001 授权100，清算120](http://127.0.0.1:8852/transactions?scenario=S03-R001)|`DEMO-SLASH-S03-R001-T1`|-120.00|0.00|授权100，最终支出120；补扣20的渠道规则待确认。 待Slash确认|
|[S04-R001 一次授权分两次清算](http://127.0.0.1:8852/transactions?scenario=S04-R001)|`DEMO-SLASH-S04-R001-AUTH`<br>`DEMO-SLASH-S04-R001-T1`<br>`DEMO-SLASH-S04-R001-T2`|-100.00|0.00|内部将两笔60/40清算关联原授权；公开API未给出通用父授权字段。 待Slash确认|
|[S05-R001 授权拒绝](http://127.0.0.1:8852/transactions?scenario=S05-R001)|`DEMO-SLASH-S05-R001-T1`|0.00|0.00|拒绝不影响已入账或可用余额。 Demo规则验证|
|[S06-R001 授权全额撤销](http://127.0.0.1:8852/transactions?scenario=S06-R001)|`DEMO-SLASH-S06-R001-T1`|0.00|0.00|原冻结100全部释放，支出0。 Demo规则验证|
|[S07-R001 部分授权撤销](http://127.0.0.1:8852/transactions?scenario=S07-R001)|`DEMO-SLASH-S07-R001-T1`|0.00|60.00|释放40，剩余授权冻结60；表达方式待确认。 待Slash确认|
|[S08-R001 授权过期后延迟清算](http://127.0.0.1:8852/transactions?scenario=S08-R001)|`DEMO-SLASH-S08-R001-AUTH`<br>`DEMO-SLASH-S08-R001-T1`|-100.00|0.00|内部过期释放后收到100清算；过期来源状态映射待确认。 待Slash确认|
|[S09-R001 未匹配原授权的清算](http://127.0.0.1:8852/transactions?scenario=S09-R001)|`DEMO-SLASH-S09-R001-T1`|-80.00|0.00|80支出正常计入已入账；关联仍未匹配，禁止自动对账成功。 待Slash确认|
|[S10-R001 清算后全额退款](http://127.0.0.1:8852/transactions?scenario=S10-R001)|`DEMO-SLASH-S10-R001-T1`<br>`DEMO-SLASH-S10-R001-REF1`|0.00|0.00|原消费100保留，独立退款+100。 待Slash确认|
|[S11-R001 清算后部分退款](http://127.0.0.1:8852/transactions?scenario=S11-R001)|`DEMO-SLASH-S11-R001-T1`<br>`DEMO-SLASH-S11-R001-REF1`|-70.00|0.00|原消费100，独立退款+30，净支出70。 待Slash确认|
|[S12-R001 同一订单多次部分退款](http://127.0.0.1:8852/transactions?scenario=S12-R001)|`DEMO-SLASH-S12-R001-T1`<br>`DEMO-SLASH-S12-R001-REF1`<br>`DEMO-SLASH-S12-R001-REF2`|-50.00|0.00|原消费100，退款+20、+30分别累计；订单号不唯一。 待Slash确认|
|[S13-R001 退款处理失败](http://127.0.0.1:8852/transactions?scenario=S13-R001)|`DEMO-SLASH-S13-R001-T1`<br>`DEMO-SLASH-S13-R001-REF1`|-100.00|0.00|原消费100，失败退款+100无余额影响。 待Slash确认|
|[S14-R001 争议、临时贷记与扣回](http://127.0.0.1:8852/transactions?scenario=S14-R001)|`DEMO-SLASH-S14-R001-T1`|-100.00|0.00|消费100；内部临时贷记+100、后续扣回-100；Slash表示方式待确认。 待Slash确认|
|[S15-R001 外币消费与外汇费用](http://127.0.0.1:8852/transactions?scenario=S15-R001)|`DEMO-SLASH-S15-R001-T1`<br>`DEMO-SLASH-S15-R001-FEE`|-112.20|0.00|原币100 EUR，美元入账110，独立外汇费2.20；费用信息不重复扣款。 待Slash确认|
|[S16-R001 费用冲回、返现与调整](http://127.0.0.1:8852/transactions?scenario=S16-R001)|`DEMO-SLASH-S16-R001-T1`<br>`DEMO-SLASH-S16-R001-FEE`|-98.50|0.00|消费100+费用3；内部费用冲回3、返现2、返现调整-0.50；净支出98.50。 待Slash确认|
|[S17-R001 跨月清算与退款](http://127.0.0.1:8852/transactions?scenario=S17-R001)|`DEMO-SLASH-S17-R001-T1`<br>`DEMO-SLASH-S17-R001-REF1`|-75.00|0.00|7月31日授权100，8月1日入账100，9月1日退款25；按入账月统计。 待Slash确认|
|[S18-R001 Webhook重复、乱序及补同步](http://127.0.0.1:8852/transactions?scenario=S18-R001)|`DEMO-SLASH-S18-R001-T1`<br>`DEMO-SLASH-S18-R001-T2`<br>`DEMO-SLASH-S18-R001-T3`|-90.00|0.00|三笔30消费；重复通知幂等、旧响应不回退、漏通知通过补同步恢复。 待Slash确认|
|[S19-R001 待审批不占用余额](http://127.0.0.1:8852/transactions?scenario=S19-R001)|`DEMO-SLASH-S19-R001-T1`|0.00|0.00|pending_approval金额100，但可用与已入账余额都不变。 Demo规则验证|
|[S20-R001 缺失可选字段与真实零值](http://127.0.0.1:8852/transactions?scenario=S20-R001)|`DEMO-SLASH-S20-R001-T1`|0.00|0.00|零值入账交易保留0；未提供授权时间、汇率及商户数据保持缺失。 Demo规则验证|

合计：33条当前交易、20账户、20虚拟账户、20卡、20余额、2费用明细。来源已入账支出1485.20 USD，来源已入账收入205.00 USD，来源净额-1280.20 USD；内部调整净额+4.50 USD，合并净变化-1275.70 USD。20账户期末posted合计18724.30 USD，可用合计18664.30 USD（仅这批相同USD/debit分组，不作为跨类型合计示例）。
