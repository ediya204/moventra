// Read-only, personal-customer test snapshots. No admin/provider proxy.
export function isCardSnapshotPath(path: string): boolean {
 if (path.includes('#') || path.split('?').length > 2) return false;
 const [pathname,query='']=path.split('?');
 const base='/client-api/v1/customers/[0-9a-f-]{36}/card-projections';
 if(new RegExp(`^${base}$`).test(pathname))return !query;
 if(new RegExp(`^${base}/[A-Za-z0-9_-]+/(cards|transactions)/[A-Za-z0-9_-]+$`).test(pathname))return !query;
 if(!new RegExp(`^${base}/[A-Za-z0-9_-]+/(cards|transactions)$`).test(pathname))return false;
 const params=new URLSearchParams(query);
 const allowed=pathname.endsWith('/cards')?['page','revision','keyword','cardStatus']:['page','revision','keyword','detailedStatus','from','to','cardId'];
 return [...params.keys()].every(key=>allowed.includes(key)&&params.getAll(key).length===1);
}
export function snapshotAmount(value?:string|null, currency='USD'):string {
 if(value==null || !/^(0|-?[1-9][0-9]*)$/.test(value))return '未知';
 if(!['USD','CNY','AED'].includes(currency))return `${currency} ${value}（来源最小单位）`;
 const negative=value.startsWith('-'), digits=(negative?value.slice(1):value).padStart(3,'0');
 return `${currency} ${negative?'−':''}${digits.slice(0,-2)}.${digits.slice(-2)}`;
}
