export type Daily = {date:string;incomingMinor:string|null;outgoingMinor:string|null;netMinor:string|null;posted:number;pending:number;failed:number;total:number};
export type Overview = {
 mode:'real_readonly'|'production';asOf:string;revision:string;range:{from:string;to:string;timezone:string;days:number};
 coverage:{complete:boolean;reason:string};currency:string;scale:number;timeBasis:string;
 totals:{incomingMinor:string;outgoingMinor:string;netMinor:string;transactions:number;posted:number;pending:number;failed:number;review:number;activeCards:number|null;selectedCards:number|null;customers:number|null;activeCustomers:number|null};
 daily:Daily[];statuses:{status:string;count:number}[];merchants:{name:string;amountMinor:string;count:number}[];currencies:{code:string;count:number}[];
 availability:{merchants:boolean;cards:boolean;customers:boolean};sync:{lastSuccessAt:string|null;state:string;mode:string};
};
export function money(value:string|null|undefined){
 if(value==null||!/^[-]?\d+$/.test(value))return '—';
 const n=BigInt(value),a=n<0n?-n:n;
 return (n<0n?'−':'')+(a/100n).toLocaleString('en-US')+'.'+String(a%100n).padStart(2,'0');
}
// Normalize only geometry to a bounded number. Labels retain exact minor units.
export function ratio(value:string|null, maximum:bigint){if(value==null||maximum<=0n)return 0;const n=BigInt(value);return Number((n<0n?-n:n)*1000000n/maximum)/1000000;}
export function maximum(rows:Daily[]){return rows.reduce((max,r)=>[r.incomingMinor,r.outgoingMinor].reduce((m,v)=>v!=null&&BigInt(v)>m?BigInt(v):m,max),0n);}
export function percent(count:number,total:number){return total?((count/total)*100).toFixed(1)+'%':'—';}
export function safeCsv(value:unknown){const t=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(t)?"'"+t:t).replaceAll('"','""')+'"';}
