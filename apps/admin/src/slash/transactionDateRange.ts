export type TransactionDateRange={mode:string;fromDate:string;toDate:string;from:string;to:string;label:string;error:string};
const day=86400000;
const key=(time:number)=>new Date(time).toISOString().slice(0,10);
function parseDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
 const time=Date.parse(value+'T00:00:00.000Z');
 return Number.isFinite(time)&&key(time)===value?time:NaN;
}
/** Inclusive UTC calendar dates become one explicit [from, to) API interval. */
export function transactionDateRange(params:URLSearchParams,now=Date.now()):TransactionDateRange{
 const mode=params.get('range')||'30',today=key(now),midnight=Date.parse(today+'T00:00:00.000Z');
 let fromDate=params.get('fromDate')||'',toDate=params.get('toDate')||'',error='';
 if(['7','14','30'].includes(mode)){fromDate=key(midnight-(Number(mode)-1)*day);toDate=today;}
 else if(mode!=='custom')error='请选择有效的时间范围。';
 const start=parseDate(fromDate),end=parseDate(toDate);
 if(!error&&(!Number.isFinite(start)||!Number.isFinite(end)))error='请填写有效的 UTC 开始和结束日期。';
 if(!error&&start>end)error='开始日期不能晚于结束日期。';
 if(!error&&end>midnight)error='结束日期不能晚于今天（UTC）。';
 if(!error&&end-start+day>30*day)error='单次查询最多 30 天，请缩短时间范围。';
 return {mode,fromDate,toDate,from:error?'':new Date(start).toISOString(),to:error?'':new Date(end+day).toISOString(),label:error?'日期范围无效':`${fromDate} 至 ${toDate}（UTC，含结束日）`,error};
}
