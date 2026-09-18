export const fundRecordKinds: Record<string,string> = {deposit:'充值入金',withdrawal:'提现出金',card_in:'卡片转入 / 首充',card_out:'卡片转出',otc:'OTC 兑换',manual_in:'人工入金',manual_out:'人工出金',reversal:'人工冲正',opening_fee:'开卡费',fee:'手续费',fee_refund:'费用退回',funding_return:'首充退回'};
export const fundRecordStatuses: Record<string,string> = {pending_review:'待审核',processing:'处理中',completed:'已完成',failed:'失败',rejected:'已拒绝',cancelled:'已取消',unknown:'待确认'};
export const recordIdPattern = /^(crypto|manual|issuing|issuing_deposit)_[0-9a-f-]{36}_(principal|fee|funding|refund-[0-9a-f-]{36})$/;
export type FundRecord = {id:string;source:'crypto'|'manual'|'issuing'|'issuing_deposit';orderId:string;fundingSource?:string;customerId:string;customerName?:string;createdAt:string;updatedAt:string;kind:string;direction:string;currency:string;amountMinor:string|null;toCurrency?:string;receiveMinor?:string|null;cardId?:string;last4?:string;network?:string;address?:string;txHash?:string;originalId?:string;sourceState:string;postingStatus:string;status:string};
export type FundEvidence={id:string;step:string;state:string;currency:string;amountMinor:string;from:string;to:string;createdAt:string};
export type FundRecordsResult={records:FundRecord[];total:number;pageSize:20;mode:string;coverage:string;record?:FundRecord;evidence?:FundEvidence[]};
export function fundRecordsRoute(method:string,path:string):boolean {
 if(method!=='GET'||!path.startsWith('/')||path.startsWith('//')||path.includes('#'))return false;
 const [pathname,query='']=path.split('?');if(path.split('?').length>2)return false;
 const match=pathname.match(/^\/(client|admin)-api\/v1\/fund-records(?:\/([^/]+))?$/);if(!match)return false;
 if(match[2])return recordIdPattern.test(match[2])&&!query;
 const params=new URLSearchParams(query),allowed=['page','kind','status','currency','from','to','cardId','customerId','q'];
 return [...params.keys()].every(k=>allowed.includes(k)&&params.getAll(k).length===1);
}
