const record=/^(crypto|manual|issuing|issuing_deposit)_[0-9a-f-]{36}_(principal|fee|funding|refund-[0-9a-f-]{36})$/;
export function fundRecordsRoute(method,path){
 if(method!=='GET'||!path.startsWith('/')||path.startsWith('//')||path.includes('#'))return false;
 const [pathname,query='']=path.split('?');if(path.split('?').length>2)return false;
 const match=pathname.match(/^\/(client|admin)-api\/v1\/fund-records(?:\/([^/]+))?$/);if(!match)return false;
 if(match[2])return record.test(match[2])&&!query;
 const params=new URLSearchParams(query),allowed=['page','kind','status','currency','from','to','cardId','customerId','q'];
 return [...params.keys()].every(k=>allowed.includes(k)&&params.getAll(k).length===1);
}
