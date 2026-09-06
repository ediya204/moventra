import {apiGet,unwrapData} from '../api/client';
import {adminDemoBase,sourceApiBase} from './portalRouting';
export const demoBase=adminDemoBase;
export async function readDemo<T>(path:string,query?:Record<string,unknown>,portal=false){return unwrapData(await apiGet<T>(`${sourceApiBase(portal)}/${path}`,query));}
export function money(cents:number|null|undefined,currency='USD'){
 if(cents==null||!Number.isSafeInteger(cents))return '—';
 const amount=BigInt(cents),abs=amount<0n?-amount:amount;
 return `${amount<0n?'−':''}${abs/100n}.${String(abs%100n).padStart(2,'0')} ${currency}`;
}
export const statusLabels:Record<string,string>={pending:'处理中',posted:'已入账',failed:'未入账 / 失败',active:'正常启用',paused:'已暂停',inactive:'未激活',closed:'已关闭',open:'已开立'};
export const detailLabels:Record<string,string>={pending:'待处理',pending_approval:'待审批',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'授权拒绝',refund:'退款',reversed:'授权撤销',returned:'退回',dispute:'争议'};
export const matchingLabels:Record<string,string>={demo_verified:'Demo规则已验证',pending_confirmation:'待Slash确认',unmatched:'未匹配 / 待确认'};
