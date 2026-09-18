import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import React from'react';import Renderer,{act}from'react-test-renderer';import{MemoryRouter}from'react-router-dom';import ts from'typescript';
const require=createRequire(import.meta.url),resolve=s=>pathToFileURL(require.resolve(s)).href,uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),compile=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const state=globalThis.__fundsFlowFixture={reads:[],writes:[]},memory=new Map();globalThis.sessionStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};globalThis.document={hidden:false};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children,...p})=>React.createElement('div',p,children);export const Box=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableContainer=Pass,TableBody=Pass,TableCell=Pass,TableHead=Pass,TableRow=Pass,Typography=Pass,MenuItem=Pass;export const TextField=p=>React.createElement('input',p);export const Chip=({label})=>React.createElement('span',null,label);export const Alert=({children,action})=>React.createElement('div',null,children,action);export const Button=({children,...p})=>React.createElement('button',p,children);`);
const api=uri(`export const cryptoError=e=>e.message;export const cryptoRequest=(path,body,key)=>new Promise((resolve,reject)=>globalThis.__fundsFlowFixture[body===undefined?'reads':'writes'].push({path,body,key,resolve,reject}));`),auth=uri('export const useAuth=()=>({session:{id:"actor"}})'),live=uri('export class SessionError extends Error{}'),qr=uri(`import React from ${JSON.stringify(resolve('react'))};export const QRCodeSVG=p=>React.createElement('svg',{'data-value':p.value});`),contract=uri(compile('../../packages/shared/src/auth/cryptoContract.ts'));
const sectionNav=uri(compile('../../packages/shared/src/components/SectionNavigation.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:resolve(n))));
const fundsNav=uri(compile('../../packages/shared/src/finance/FundsNavigation.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:n.endsWith('/SectionNavigation')?sectionNav:resolve(n))));
const transferLayout=uri(compile('../../packages/shared/src/finance/CryptoTransferLayout.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:resolve(n))));
const deposit=uri(compile('../../packages/shared/src/finance/DepositAddress.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='./CryptoTransferLayout'?transferLayout:n==='@mui/material'?shell:n==='qrcode.react'?qr:n.endsWith('/cryptoContract')?contract:n.endsWith('/FundsNavigation')?fundsNav:n.endsWith('/cryptoApi')?api:resolve(n))));
const otc=uri(compile('../../packages/shared/src/finance/OtcExchange.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:n.endsWith('/cryptoContract')?contract:n.endsWith('/cryptoApi')?api:resolve(n))));
const component=uri(compile('../../packages/shared/src/finance/CustomerFunds.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='./CryptoTransferLayout'?transferLayout:n==='./OtcExchange'?otc:n==='./DepositAddress'?deposit:n.endsWith('/FundsNavigation')?fundsNav:n==='@mui/material'?shell:n==='qrcode.react'?qr:n.endsWith('/cryptoContract')?contract:n.endsWith('/FundsNavigation')?fundsNav:n.endsWith('/cryptoContract')?contract:n.endsWith('/cryptoApi')?api:n.endsWith('/AuthContext')?auth:n.endsWith('/liveApi')?live:resolve(n))));const Funds=(await import(component)).default;
const id='10000000-0000-0000-0000-000000000001',base={mode:'live',executionEligible:true,customerId:id,canOperate:true,settings:{},ledger:{accounts:[]},addresses:[],addressJobs:{},orders:[],total:0,networks:[{network:'TRC20',depositEnabled:true,withdrawEnabled:true},{network:'ERC20',depositEnabled:true,withdrawEnabled:true}]};const flush=()=>new Promise(r=>setImmediate(r));
async function mount(path='/portal/funds/deposit',props={}){let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Funds,{customerId:id,...props})));await flush()});return tree}
async function reply(call,v){await act(async()=>{call.resolve(v);await flush()})}
test('standard deposit reuses address, clears QR on unavailable network and creates once',async()=>{state.reads=[];state.writes=[];const tree=await mount();assert.match(state.reads[0].path,/deposit-addresses$/);await reply(state.reads[0],{address:{network:'TRC20',state:'not_created',address:''},events:[]});assert.equal(state.writes.length,1);assert.deepEqual(state.writes[0].body,{network:'TRC20'});await reply(state.writes[0],{address:{network:'TRC20',state:'completed',address:'fixture-address'},events:[]});assert.equal(tree.root.findAllByType('svg')[0].props['data-value'],'fixture-address');await act(()=>tree.root.findAllByType('input').find(n=>n.props.label==='网络').props.onChange({target:{value:'ERC20'}}));assert.equal(tree.root.findAllByType('svg').length,0);assert.equal(state.writes.length,1);await act(()=>tree.unmount())});
test('existing address and unknown request are never recreated after page refresh',async()=>{for(const status of ['completed','submitting','verifying','unknown']){state.reads=[];state.writes=[];const tree=await mount();await reply(state.reads[0],{address:{network:'TRC20',state:status,address:status==='completed'?'fixture-address':''},events:[]});assert.equal(state.writes.length,0);await act(()=>tree.unmount())}});
test('unopened customer read failure never requests an address',async()=>{state.reads=[];state.writes=[];const tree=await mount();await act(async()=>{state.reads[0].reject(new Error('user_not_enabled'));await flush()});assert.equal(state.writes.length,0);await act(()=>tree.unmount())});

test('disabled deployment shows four flows without inventing available money or sending writes',async()=>{for(const path of ['/portal/funds','/portal/funds/deposit','/portal/funds/withdraw','/portal/funds/exchange']){state.reads=[];state.writes=[];memory.clear();const tree=await mount(path);const E=(await import(live)).SessionError;const error=new E('disabled');error.code='crypto_disabled';await act(async()=>{state.reads[0].reject(error);await flush()});const text=JSON.stringify(tree.toJSON());assert.match(text,path.endsWith('/deposit')?/disabled/:/正式账本暂不可用/);assert.doesNotMatch(text,/0\.000000 USDT/);assert.equal(state.writes.length,0);const submitButtons=tree.root.findAllByType('button').filter(n=>['查看费用','成交','重新查询地址'].includes(n.props.children));assert.ok(submitButtons.every(n=>n.props.disabled));await act(()=>tree.unmount())}});
test('deposit pilot shows exact allowance and only posted ledger results as credited',async()=>{state.reads=[];state.writes=[];const tree=await mount('/portal/funds/deposit');await reply(state.reads[0],{address:{network:'TRC20',state:'completed',address:'fixture-address'},postingEnabled:true,mode:'deposit_pilot',pilot:{capMinor:'1000000',remainingMinor:'400000',walletMinor:'600000'},events:[{id:'event',amount:'0.6',txHash:'fixture',receivedAt:new Date().toISOString(),state:'verified',posting:'pending'}]});let text=JSON.stringify(tree.toJSON());assert.match(text,/0.40/);assert.match(text,/0.60/);assert.match(text,/记账处理中/);assert.doesNotMatch(text,/链上已确认 · 已入账/);await act(()=>tree.unmount())});
const walletModule=uri(compile('../../apps/client/src/portal/ProductionWallet.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n.endsWith('/finance/CustomerFunds')?component:n==='@mui/material'?shell:n.endsWith('/cryptoContract')?contract:n.endsWith('/cryptoApi')?api:resolve(n))));const Wallet=(await import(walletModule)).default;
test('production wallet shows formal balances and never accepts a shadow response',async()=>{for(const mode of ['live','shadow']){state.reads=[];state.writes=[];let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,null,React.createElement(Wallet,{customerId:id})));await flush()});assert.match(state.reads[0].path,/\/crypto\?limit=5$/);await reply(state.reads[0],{...base,mode,ledger:{reconciliation:'matched',accounts:[{kind:'wallet',currency:'USDT',ledgerAvailableMinor:'100000'}]}});const text=JSON.stringify(tree.toJSON());if(mode==='live'){assert.match(text,/0.10 USDT/);assert.match(text,/尚未开通/);assert.doesNotMatch(text,/"0\.00 USD"/)}else{assert.doesNotMatch(text,/0.10/);assert.match(text,/正式资金暂不可用/)}assert.doesNotMatch(text,/测试钱包|测试资金/);await act(()=>tree.unmount())}});

test('production deposit has no pilot cap and disabled channel explains its own limitation',async()=>{state.reads=[];state.writes=[];let tree=await mount('/portal/funds/deposit');await reply(state.reads[0],{address:{state:'completed',address:'fixture'},mode:'production',postingEnabled:true,events:[]});let text=JSON.stringify(tree.toJSON());assert.match(text,/TRC20 正式充值已开通/);assert.doesNotMatch(text,/剩余额度|请勿超额/);await act(()=>tree.unmount());state.reads=[];tree=await mount('/portal/funds/withdraw');await reply(state.reads[0],{...base,canOperate:true,networks:[{network:'TRC20',withdrawEnabled:false}]});text=JSON.stringify(tree.toJSON());assert.match(text,/出金渠道尚未完成核验/);assert.doesNotMatch(text,/资金服务尚未启用/);await act(()=>tree.unmount())});


test('funds navigation omits standalone manual records and preserves selected route',async()=>{
 state.reads=[];const tree=await mount('/portal/funds');await reply(state.reads[0],base);
 const buttons=tree.root.findAllByType('button');
 assert.equal(buttons.filter(b=>b.props.to==='/portal/funds/manual').length,0);
 assert.equal(buttons.filter(b=>b.props.to==='/portal/funds/exchange').length,1);
 assert.equal(buttons.find(b=>b.props.to==='/portal/funds').props['aria-current'],'page');
 await act(()=>tree.unmount());
});

test('card detail fixes the server-mapped card and direction, preserves precision and return context',async()=>{
 state.reads=[];state.writes=[];memory.clear();const cardId='20000000-0000-0000-0000-000000000002';
 const tree=await mount('/portal/cards/channel-card?connection=source&tab=withdraw',{cardContext:{id:cardId,direction:'card_to_wallet',returnTo:'/portal/cards/channel-card?connection=source'}});
 try{
 assert.ok(state.reads[0].path.includes('cardId='+cardId));
 await reply(state.reads[0],{...base,capabilities:{cardTransfersEnabled:true},cards:[{id:cardId,name:'Mapped',last4:'1234',availableMinor:'1000',canOperate:true}]});
 const field=label=>tree.root.findAllByType('input').find(n=>n.props.label===label);
 assert.equal(field('选择卡片').props.disabled,true);assert.equal(field('选择卡片').props.value,cardId);
 await act(()=>field('金额（USD）').props.onChange({target:{value:'1.23'}}));
 await act(async()=>{tree.root.findAllByType('button').find(n=>n.props.children==='查看费用').props.onClick();await flush()});
 assert.deepEqual(state.writes[0].body,{currency:'USD',amountMinor:'123',cardId,direction:'card_to_wallet'});
 assert.equal(tree.root.findAllByType('button').find(n=>n.props.children==='返回卡片概览').props.to,'/portal/cards/channel-card?connection=source');
 }finally{await act(()=>tree.unmount());memory.clear()}
});
test('card funding history filters preserve the card scope and use server-side date and direction',async()=>{
 state.reads=[];state.writes=[];memory.clear();const cardId='20000000-0000-0000-0000-000000000002';
 const tree=await mount('/portal/cards/channel-card?connection=source&tab=funding&from=2026-09-01&to=2026-09-02&direction=card_to_wallet',{cardContext:{id:cardId,returnTo:'/portal/cards/channel-card?connection=source'}});
 try{const q=new URL('https://fixture'+state.reads[0].path).searchParams;assert.equal(q.get('cardId'),cardId);assert.equal(q.get('from'),'2026-09-01T00:00:00.000Z');assert.equal(q.get('to'),'2026-09-03T00:00:00.000Z');assert.equal(q.get('direction'),'card_to_wallet');assert.equal(q.get('kind'),'card_transfer');assert.equal(state.writes.length,0)}finally{await act(()=>tree.unmount())}
});


const waitQuote=()=>act(async()=>{await new Promise(r=>setTimeout(r,450));await flush()});
const otcBase={...base,settings:{otcEnabled:true,revision:1},ledger:{reconciliation:'matched',accounts:[{kind:'wallet',currency:'USDT',ledgerAvailableMinor:'100000000'},{kind:'wallet',currency:'USD',ledgerAvailableMinor:'10000'}]}};
const otcQuote=(request,extra={})=>({id:'quote-'+state.writes.indexOf(request),kind:'otc',customerId:id,...request.body,toCurrency:request.body.currency==='USDT'?'USD':'USDT',receiveMinor:request.body.currency==='USDT'?'123':'1000000',feeMinor:'0',rate:'0.99',policyRevision:1,expiresAt:new Date(Date.now()+60000).toISOString(),...extra});
const sell=tree=>tree.root.findAllByType('input').find(n=>n.props.label==='卖出金额');
const trade=tree=>tree.root.findAllByType('button').find(n=>n.props.children==='成交');
async function otcMount(snapshot=otcBase){state.reads=[];state.writes=[];memory.clear();const tree=await mount('/portal/funds/exchange');await reply(state.reads[0],snapshot);return tree;}

test('OTC automatically quotes exact sell amount without an order and trades only on explicit click',async()=>{
 const tree=await otcMount();try{
 assert.equal(trade(tree).props.disabled,true);
 await act(()=>sell(tree).props.onChange({target:{value:'1.234567'}}));
 assert.equal(state.writes.length,0);await waitQuote();assert.equal(state.writes.length,1);
 assert.deepEqual(state.writes[0].body,{currency:'USDT',amountMinor:'1234567'});assert.match(state.writes[0].path,/otc\/quotes$/);
 const q=otcQuote(state.writes[0]);await reply(state.writes[0],q);
 assert.match(JSON.stringify(tree.toJSON()),/1.23 USD/);assert.equal(trade(tree).props.disabled,false);
 assert.equal(state.writes.length,1);const click=trade(tree).props.onClick;
 await act(async()=>{click();click();await flush()});assert.equal(state.writes.length,2);
 assert.match(state.writes[1].path,/otc\/orders$/);assert.deepEqual(state.writes[1].body,{quoteId:q.id});
 }finally{await act(()=>tree.unmount());memory.clear()}
});

test('OTC debounces input, ignores out-of-order quotes and clears on direction change',async()=>{
 const tree=await otcMount();try{
 await act(()=>sell(tree).props.onChange({target:{value:'1'}}));await act(()=>sell(tree).props.onChange({target:{value:'2'}}));await waitQuote();
 assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.amountMinor,'2000000');const old=state.writes[0];
 await act(()=>sell(tree).props.onChange({target:{value:'3'}}));await waitQuote();const latest=state.writes[1];
 await reply(latest,otcQuote(latest,{receiveMinor:'297'}));await reply(old,otcQuote(old,{receiveMinor:'198'}));
 assert.match(JSON.stringify(tree.toJSON()),/2.97 USD/);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/1.98 USD/);
 await act(()=>tree.root.findAllByType('button').find(n=>n.props['aria-label']==='切换兑换方向').props.onClick());assert.equal(sell(tree).props.value,'');assert.equal(trade(tree).props.disabled,true);
 await act(()=>sell(tree).props.onChange({target:{value:'0.01'}}));await waitQuote();assert.deepEqual(state.writes[2].body,{currency:'USD',amountMinor:'1'});
 }finally{await act(()=>tree.unmount())}
});

test('OTC rejects invalid precision, mismatched quotes and insufficient balance including fees',async()=>{
 const tree=await otcMount({...otcBase,ledger:{reconciliation:'matched',accounts:[{kind:'wallet',currency:'USDT',ledgerAvailableMinor:'1000000'}]}});try{
 await act(()=>sell(tree).props.onChange({target:{value:'0.0000001'}}));await waitQuote();assert.equal(state.writes.length,0);assert.equal(trade(tree).props.disabled,true);
 await act(()=>sell(tree).props.onChange({target:{value:'1'}}));await waitQuote();await reply(state.writes[0],otcQuote(state.writes[0],{customerId:'other'}));assert.equal(trade(tree).props.disabled,true);assert.match(JSON.stringify(tree.toJSON()),/报价已变化/);
 await act(()=>tree.root.findAllByType('button').find(n=>n.props.children==='重试报价').props.onClick());await waitQuote();await reply(state.writes[1],otcQuote(state.writes[1],{feeMinor:'1'}));assert.equal(trade(tree).props.disabled,true);assert.match(JSON.stringify(tree.toJSON()),/可用余额不足/);
 }finally{await act(()=>tree.unmount())}
});

test('OTC quote failures are retryable and expired prices refresh without placing orders',async()=>{
 const tree=await otcMount();try{
 await act(()=>sell(tree).props.onChange({target:{value:'1'}}));await waitQuote();await act(async()=>{state.writes[0].reject(new Error('报价网络异常'));await flush()});
 assert.equal(trade(tree).props.disabled,true);assert.match(JSON.stringify(tree.toJSON()),/报价网络异常/);
 await act(()=>tree.root.findAllByType('button').find(n=>n.props.children==='重试报价').props.onClick());await waitQuote();
 await reply(state.writes[1],otcQuote(state.writes[1],{expiresAt:new Date(Date.now()+80).toISOString()}));
 await act(async()=>{await new Promise(r=>setTimeout(r,120));await flush()});assert.equal(trade(tree).props.disabled,true);await waitQuote();assert.equal(state.writes.length,3);assert.ok(state.writes.every(r=>r.path.endsWith('/quotes')));
 }finally{await act(()=>tree.unmount())}
});

test('OTC uncertain trade preserves the same request through reload instead of quoting or submitting again',async()=>{
 let tree=await otcMount();
 try{await act(()=>sell(tree).props.onChange({target:{value:'1'}}));await waitQuote();await reply(state.writes[0],otcQuote(state.writes[0]));await act(async()=>{trade(tree).props.onClick();await flush()});const order=state.writes[1];
 await act(async()=>{order.reject(new Error('订单结果待确认'));await flush()});assert.equal(trade(tree).props.disabled,true);
 await act(()=>tree.unmount());state.reads=[];tree=await mount('/portal/funds/exchange');await reply(state.reads[0],otcBase);await waitQuote();assert.equal(state.writes.length,2);
 await act(async()=>{tree.root.findAllByType('button').find(n=>n.props.children==='核对并重试原请求').props.onClick();await flush()});assert.equal(state.writes.length,3);assert.equal(state.writes[2].key,order.key);assert.deepEqual(state.writes[2].body,order.body);
 }finally{await act(()=>tree.unmount());memory.clear()}
});

test('withdrawal styled form retains exact quote binding and clears it when network changes',async()=>{
 state.reads=[];state.writes=[];memory.clear();const tree=await mount('/portal/funds/withdraw');
 try{
  await reply(state.reads[0],base);
  const field=label=>tree.root.findAllByType('input').find(n=>n.props.label===label);
  await act(()=>field('提款金额（USDT）').props.onChange({target:{value:'1.234567'}}));
  await act(()=>field('收款地址').props.onChange({target:{value:'isolated-recipient'}}));
  await act(async()=>{tree.root.findAllByType('button').find(n=>n.props.children==='查看费用').props.onClick();await flush()});
  assert.deepEqual(state.writes[0].body,{currency:'USDT',amountMinor:'1234567',network:'TRC20',address:'isolated-recipient'});
  await reply(state.writes[0],{id:'withdraw-quote',amountMinor:'1234567',feeMinor:'10000',receiveMinor:'1234567',currency:'USDT',toCurrency:'USDT',expiresAt:new Date(Date.now()+60000).toISOString()});
  assert.equal(state.writes.length,1);
  assert.ok(tree.root.findAllByType('button').some(n=>n.props.children==='发起提款'&&!n.props.disabled));
  await act(()=>field('网络').props.onChange({target:{value:'ERC20'}}));
  assert.equal(field('收款地址').props.value,'');
  assert.equal(tree.root.findAllByType('button').filter(n=>n.props.children==='发起提款').length,0);
  assert.equal(state.writes.length,1);
 }finally{await act(()=>tree.unmount());memory.clear()}
});

test('removed standalone fiat routes return to funds overview without creating a request',async()=>{
 for(const path of ['/portal/funds/fiat','/portal/funds/fiat-deposit','/portal/funds?tab=fiat']){
  state.reads=[];state.writes=[];memory.clear();const tree=await mount(path);
  try{
   await reply(state.reads[0],base);
   const buttons=tree.root.findAllByType('button');
   assert.equal(buttons.find(b=>b.props.to==='/portal/funds').props['aria-current'],'page');
   assert.equal(buttons.filter(b=>b.props.to==='/portal/funds/fiat').length,0);
   assert.equal(tree.root.findAllByType('input').filter(n=>n.props.label==='选择卡片').length,0);
   assert.equal(state.writes.length,0);
  }finally{await act(()=>tree.unmount())}
 }
});
