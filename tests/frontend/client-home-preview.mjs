// Explicitly isolated visual harness for real client components. Never imported
// by the application. Synthetic identity, reads and ephemeral quotes only; all
// orders and other business writes are rejected.
import {createServer} from 'vite';
import ts from 'typescript';
import {resolve} from 'node:path';
const root=resolve('.');
const fixture=String.raw`
const customerId='10000000-0000-0000-0000-000000000001', id='20000000-0000-0000-0000-000000000001';
const createdAt='2026-09-19T02:30:00Z';
const orders=[{id,customerId,kind:'deposit',currency:'USDT',amountMinor:'100000',feeMinor:'0',receiveMinor:'100000',toCurrency:'USDT',state:'completed',network:'TRC20',createdAt,approvalStatus:'not_required',providerStatus:'completed',postingStatus:'posted'}];
const cards=Array.from({length:23},(_,i)=>({id:'card-'+i,name:['Marketing team','Software subscriptions','Travel expenses'][i%3],cardName:['Marketing team','Software subscriptions','Travel expenses'][i%3],last4:String(2047+i),cardStatus:i%3?'active':'paused',createdAtUTC:createdAt,network:'Visa',cvvAvailable:false,fundingCardId:null,metrics:{currency:'USD',scale:2,availableMinor:i===2?null:'148500',availableAt:createdAt,availability:i===2?'not_supported':'available',coverage:i===3?'incomplete':'complete',spendingMinor:i===3?null:['84250','42680','21900','0','10515'][i%5],refundMinor:'0',from:'2026-08-20T02:30:00Z',to:createdAt,updatedAt:createdAt,syncState:'idle'}}));
const transactions=[{id:'tx-1',cardId:'card-0',cardName:'Marketing team',cardLast4:'2047',merchant:'OpenAI',amountCents:'-2000',originalCurrency:{code:'USD',amountCents:'-2000'},status:'posted',detailedStatus:'settled',date:createdAt}];
export class SessionError extends Error{};export class IssuingError extends Error{};
export const authMessage=e=>e.message,cryptoError=authMessage,manualError=authMessage;
const blocked=()=>Promise.reject(new Error('隔离预览不执行任何写操作'));
export const liveCardSync=blocked,liveCardAction=blocked,updateOnboarding=blocked,registerUser=blocked;
export async function liveGet(path,body){
 if(body!==undefined){
  if(path.endsWith('/otc/quotes')){
   await new Promise(r=>setTimeout(r,200));
   if(sessionStorage.getItem('layout-fixture-quote-error')==='1')throw new Error('隔离报价故障，请重试');
   const amount=BigInt(body.amountMinor),receive=body.currency==='USDT'?amount*99n/1000000n:amount*9900n;
   if(receive<=0n)throw new Error('卖出金额太小，请增加金额后重试');
   return {id:crypto.randomUUID(),kind:'otc',customerId,currency:body.currency,toCurrency:body.currency==='USDT'?'USD':'USDT',amountMinor:body.amountMinor,receiveMinor:receive.toString(),feeMinor:'0',rate:'0.99',policyRevision:1,expiresAt:new Date(Date.now()+60000).toISOString()};
  }
  return blocked();
 }
 await new Promise(r=>setTimeout(r,120));
 const url=new URL(path,'http://fixture.invalid'),p=url.pathname,q=url.searchParams;
 if(sessionStorage.getItem('layout-fixture-error')==='1')throw new Error('隔离故障：服务暂不可用，请重试');
 const empty=sessionStorage.getItem('layout-fixture-empty')==='1';
 if(p.endsWith('/onboarding'))return {customerId,onboardingStatus:'approved',serviceStatus:'active',allFeaturesEnabled:true,revision:1};
 if(p.endsWith('/card-projections'))return [{id:'fixture',label:'我的卡片',revision:'v1'}];
 if(p.includes('/card-projections/')){
  const isCard=p.includes('/cards'),detail=/\/(cards|transactions)\/[^/]+$/.test(p);let rows=empty?[]:isCard?cards:transactions;
  if(!isCard&&q.get('metric')==='spending'){
   const card=cards.find(c=>c.id===q.get('cardId'));rows=[];
   if(card&&card.metrics.spendingMinor!==null){const total=BigInt(card.metrics.spendingMinor);let used=0n;rows=Array.from({length:30},(_,i)=>{const amount=i===29?total-used:total*BigInt(i%5+1)/90n;used+=amount;return {id:'trend-'+card.id+'-'+i,cardId:card.id,amountCents:(-amount).toString(),status:'posted',detailedStatus:'settled',date:new Date(Date.parse(card.metrics.from)+i*86400000+3600000).toISOString()}}).filter(r=>r.amountCents!=='0')}
  }
  if(detail)rows=rows.filter(r=>r.id===p.split('/').at(-1));
  if(q.get('keyword'))rows=rows.filter(r=>(r.name+' '+r.last4+' '+r.merchant).toLowerCase().includes(q.get('keyword').toLowerCase()));
  if(q.get('cardStatus'))rows=rows.filter(r=>r.cardStatus===q.get('cardStatus'));
  if(q.get('detailedStatus'))rows=rows.filter(r=>r.detailedStatus===q.get('detailedStatus'));
  if(q.get('from'))rows=rows.filter(r=>r.date&&Date.parse(r.date)>=Date.parse(q.get('from')));
  if(q.get('to'))rows=rows.filter(r=>r.date&&Date.parse(r.date)<Date.parse(q.get('to')));
  const page=Number(q.get('page')||0);return {rows:rows.slice(page*20,(page+1)*20),total:rows.length,page,revision:'v1',sourceAt:createdAt,importedAt:createdAt,coverageReason:'隔离合成数据，仅用于界面验收'};
 }
 if(p.includes('/deposit-addresses'))return {address:{network:'TRC20',state:'completed',address:'TThisIsAnIsolatedPreviewAddressDoNotUse'},mode:'production',postingEnabled:true,events:empty?[]:[{id:'notification-1',amount:'0.100000',txHash:'isolated-fixture-transaction-not-on-chain',receivedAt:createdAt,state:'verified',posting:'posted'}]};
 if(p.includes('/crypto')){
  if(p.includes('/orders/'))return {order:orders[0],events:[{action:'posted',createdAt}]};
  return {mode:'live',customerId,canOperate:true,executionEligible:true,capabilities:{otcEnabled:true,cardTransfersEnabled:false},settings:{otcEnabled:true,withdrawEnabled:false,revision:1},ledger:{reconciliation:'matched',accounts:[{kind:'wallet',currency:'USD',ledgerAvailableMinor:'248050'},{kind:'wallet',currency:'USDT',ledgerAvailableMinor:'350250000'}]},orders:empty||q.get('kind')&&q.get('kind')!=='deposit'||q.get('status')&&q.get('status')!=='completed'?[]:orders,total:empty?0:1,page:Number(q.get('page')||0),cards:[],addresses:[],networks:[{network:'TRC20',depositEnabled:true,withdrawEnabled:false},{network:'ERC20',depositEnabled:false,withdrawEnabled:false}]};
 }
 if(p.includes('/manual-funds/orders/'))return {order:{id,customerId,source:'offline_receipt',direction:'credit',state:'completed',currency:'USD',amountMinor:'10000',walletBeforeMinor:'0',walletAfterMinor:'10000',createdAt,revision:1},events:[{action:'create',createdAt}],eventsHasMore:false,mode:'live',enabled:true};
 if(p.includes('/manual-funds'))return {orders:[],total:0,page:0,mode:'disabled',enabled:false};
 if(p.includes('/card-issuing')){
  if(p.endsWith('/wallet'))return {currency:'USD',availableMinor:'0',mode:'live'};
  if(p.endsWith('/terms'))return {version:'fixture-v1',text:'本地布局预览，不接受任何开卡或资金请求'};
  if(p.includes('/products'))return empty?[]:[{id,name:'Visa USD',bin:'990001',network:'visa',feeMinor:'500',minimumMinor:'1000',description:'隔离预览卡产品',blockedReason:'issuing_disabled'}];
  if(p.includes('/cards/'))return {order:{id,cardName:'Preview card',last4:'2047',productName:'Visa USD',bin:'990001',state:'processing',fundingMinor:'1000',feeMinor:'500',totalMinor:'1500',createdAt},balanceStatus:'unknown'};
  if(/\/(orders|cards)\//.test(p))return {id,productName:'Visa USD',cardName:'Preview card',bin:'990001',state:'processing',fundingMinor:'1000',feeMinor:'500',totalMinor:'1500',createdAt};
  return [];
 }
 if(p.endsWith('/accounts'))return empty?[]:[{id:'account-1',name:'个人业务账户',status:'active'}];
 if(p.endsWith('/transactions'))return [];
 throw new Error('未配置的隔离查询：'+p);
}
export const cryptoRequest=liveGet,manualRequest=liveGet,issuingRequest=liveGet;
`;
const auth=`const customer={id:'10000000-0000-0000-0000-000000000001',name:'预览账户',kind:'personal'};const user={uid:'layout-fixture',email:'preview@example.invalid',emailVerified:true};const session={id:'layout-fixture',customers:[customer],mfaVerified:true};export const useAuth=()=>({ready:true,user,session,signOut:()=>{},refreshSession:async()=>{}});`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{ThemeProvider,CssBaseline}from'@mui/material';import theme from '/packages/shared/src/theme.ts';import ClientHome from '/apps/client/src/portal/ClientHome.tsx';import '@fontsource/public-sans/400.css';import '@fontsource/public-sans/600.css';import '@fontsource/public-sans/700.css';import '/packages/shared/src/styles.css';createRoot(document.getElementById('root')).render(<ThemeProvider theme={theme}><CssBaseline/><BrowserRouter><ClientHome/></BrowserRouter></ThemeProvider>);`;
const server=await createServer({root,publicDir:resolve('packages/assets/public'),configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:Number(process.env.MOVENTRA_PREVIEW_PORT||8868),strictPort:true},plugins:[{name:'isolated-client-layout',enforce:'pre',resolveId(id){
 if(id==='/layout-preview.tsx')return '\0layout-preview';
 if(/\/(liveApi|cryptoApi|manualFundsApi)$/.test(id)||id.endsWith('/issuing/api')||id==='./api')return '\0layout-api';
 if(id.endsWith('/AuthContext'))return '\0layout-auth';
 if(id.endsWith('/CompleteRegistration'))return '\0layout-registration';
 if(id==='firebase/auth')return '\0layout-firebase-auth';
 if(id.endsWith('/firebase'))return '\0layout-firebase';
 },load(id){
 if(id==='\0layout-preview')return ts.transpileModule(entry,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 if(id==='\0layout-api')return fixture;
 if(id==='\0layout-auth')return auth;
 if(id==='\0layout-registration')return 'export default ()=>null;';
 if(id==='\0layout-firebase-auth')return 'export const multiFactor=()=>({enrolledFactors:[{uid:"fixture"}]}),sendEmailVerification=()=>Promise.reject(new Error("Preview only")),TotpMultiFactorGenerator={};';
 if(id==='\0layout-firebase')return 'export const getFirebaseAuth=()=>({currentUser:null});';
 },configureServer(s){s.middlewares.use((req,res,next)=>{
 if(req.url?.startsWith('/client-api')||req.url?.startsWith('/admin-api')){res.statusCode=403;res.end('Isolated preview; no live API');return;}
 if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moventra · 本地合成数据布局验收</title></head><body><div role="note" style="position:fixed;bottom:8px;right:8px;z-index:1500;padding:6px 10px;border:1px solid #dfE3e8;border-radius:6px;background:white;color:#637381;font:12px sans-serif;pointer-events:none">本地布局预览 · 合成数据 · 写操作关闭</div><div id="root"></div><script type="module" src="/layout-preview.tsx"></script></body></html>')}else next();
 })}}]});
await server.listen();console.log('Synthetic read-only client preview:',server.resolvedUrls.local[0]);
