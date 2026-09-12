const day=86400000;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value))fail('时间范围必须使用带时区的 ISO 日期时间');
 const date=value.slice(0,10),calendar=Date.parse(date+'T00:00:00.000Z'),time=Date.parse(value);
 if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==date||!Number.isFinite(time))fail('无效时间范围');
 return time;
}
export function liveDateRange(query,now){
 const explicit=query.from!==undefined||query.to!==undefined;
 if(!explicit)return {from:now-30*day,to:now,includeUnknown:true};
 if(query.from===undefined||query.to===undefined)fail('开始和结束时间必须同时提供');
 const from=instant(query.from),to=instant(query.to);
 if(from>=to)fail('开始时间必须早于结束时间');
 if(to-from>30*day)fail('时间范围最多 30 天');
 if(from>now)fail('开始时间不能晚于当前时间');
 // A selected current UTC day ends next midnight in the request; future source
 // timestamps still do not enter the displayed records or their totals.
 return {from,to:Math.min(to,now),includeUnknown:false};
}
