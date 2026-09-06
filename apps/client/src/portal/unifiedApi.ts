import {apiGet,apiPost,unwrapData} from '../../../../packages/shared/src/api/client';
import type {Action,State,Entry} from './model';
export interface TransactionPage {rows:Entry[];total:number;page:number;pageSize:number;postedSpendCents:number;groupCounts:Record<string,number>}
export const readPortal = async <T,>(path:string,query?:Record<string,unknown>):Promise<T> => unwrapData(await apiGet<T>(`/local-slash-demo/portal/${path}`,query));
export const writePortal = async (action:Action,revision:number):Promise<{id:string;state:State}> => unwrapData(await apiPost<{id:string;state:State}>('/local-slash-demo/portal/action',{action,revision,requestId:`DEMO-${crypto.randomUUID()}`}));
