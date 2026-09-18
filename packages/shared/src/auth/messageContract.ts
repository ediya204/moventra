export const messageID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function messageRoute(method: string, path: string): boolean {
 if(path.includes('#') || path.split('?').length>2) return false;
 const [pathname,query='']=path.split('?'),params=new URLSearchParams(query);
 const client=new RegExp(`^/client-api/v1/customers/${messageID}/messages`);
 if(method==='POST') return !query && (new RegExp(`${client.source}/(?:read-all|${messageID}/read)$`).test(pathname)||new RegExp(`^/admin-api/v1/message-campaigns(?:/${messageID}/(?:draft|publish|retry-failed))?$`).test(pathname));
 if(method!=='GET')return false;
 if(new RegExp(`${client.source}$`).test(pathname)) return [...params].every(([k,v])=>params.getAll(k).length===1 && ({category:['','otc','letter','system'].includes(v),status:['','read','unread'].includes(v),q:v.length<=100,cursor:v.length<=2000,limit:/^\d+$/.test(v)&&+v>=1&&+v<=100} as Record<string,boolean>)[k]);
 if(new RegExp(`${client.source}/(?:summary|${messageID})$`).test(pathname)) return !query;
 if(new RegExp(`^/admin-api/v1/message-campaigns(?:/${messageID}/recipients)?$`).test(pathname)) return [...params].every(([k,v])=>k==='page'&&params.getAll(k).length===1&&/^\d+$/.test(v)&&+v<=500);
 return !query && new RegExp(`^/admin-api/v1/message-campaigns/(?:scopes|requests/${messageID}|${messageID})$`).test(pathname);
}
export type MessageSummary={unread:number;categories:Record<string,number>;snapshotToken:string};
export type Message={id:string;category:'otc'|'letter'|'system';title:string;body:string;priority:'normal'|'high';orderId?:string;resourceVersion?:number;facts:Partial<Record<'currency'|'amountMinor'|'toCurrency'|'receiveMinor'|'feeMinor'|'rate'|'state',string>>;occurredAt:string;deliveredAt:string;readAt:string|null};
export type MessagePage={items:Message[];nextCursor:string;summary:MessageSummary};
export type MessageDraft={title:string;body:string;priority:'normal'|'high';customerIds:string[];revision:number};
export type Campaign=MessageDraft&{id:string;state:'draft'|'published';createdAt:string;publishedAt:string|null;counts:Record<string,number>};
export type MessageScope={id:string;name:string;permissions:string[]};
export type Receipt={customerId:string;name:string;state:string;attempts:number;error:string;deliveredAt:string|null;readAt:string|null};
