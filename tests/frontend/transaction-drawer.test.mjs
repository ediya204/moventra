import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const reactURL=pathToFileURL(require.resolve('react')).href;
// Presentational MUI substitutes avoid DOM portals; business fields use the actual component.
const mock=uri(`import React from ${JSON.stringify(reactURL)};const Pass=({children})=>React.createElement('div',null,children);export const Accordion=Pass,AccordionDetails=Pass,AccordionSummary=Pass,Alert=Pass,Avatar=Pass,Box=Pass,Button=Pass,Chip=({label})=>React.createElement('span',null,label),Divider=Pass,Drawer=({open,children})=>open?React.createElement('div',null,children):null,IconButton=Pass,MenuItem=Pass,Paper=Pass,Skeleton=()=>null,Snackbar=()=>null,Stack=Pass,Tab=({label})=>React.createElement('span',null,label),Tabs=Pass,TextField=Pass,Tooltip=Pass,Typography=Pass,Icon=()=>null;`);
const source=readFileSync(new URL('../../apps/admin/src/slash/TransactionDrawer.tsx',import.meta.url),'utf8');
let {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:name.includes('cardTransactionFields')?new URL('../../apps/admin/src/components/cardTransactionFields.ts',import.meta.url).href:mock)}`);
const {default:Drawer}=await import(uri(outputText));
const base={open:true,loading:false,error:'',onClose(){},onRetry(){},onCard(){},transaction:{id:'DEMO-TX',merchant:'Demo Merchant',amountCents:'-304',status:'pending',detailedStatus:'pending',date:'2026-09-07T01:00:00Z',cardId:'DEMO-CARD'}};
const render=p=>renderToStaticMarkup(React.createElement(Drawer,{...base,...p}));
test('drawer keeps posted date absent for pending and does not invent customer ownership',()=>{
 const html=render({card:{id:'DEMO-CARD',cardName:'Cardholder Name',maskedCardNumber:'•••• 1319'}});
 assert.match(html,/−3.04/);assert.match(html,/尚未入账/);assert.match(html,/未绑定/);assert.match(html,/Cardholder Name/);assert.match(html,/备注未采集/);assert.match(html,/未提供或旧记录未采集/);
});
test('drawer displays only explicitly mapped customer and distinguishes zero from missing amount',()=>{
 const html=render({transaction:{...base.transaction,status:'posted',detailedStatus:'refund',amountCents:'0',internal:{customerId:'DEMO-USER',customerName:'Demo Customer'}}});
 assert.match(html,/Demo Customer/);assert.doesNotMatch(html,/未绑定|尚未入账/);assert.match(html,/0.00/);assert.match(html,/退款/);
 const unknown=render({transaction:{...base.transaction,amountCents:null,status:'new_state'}});assert.match(unknown,/未知状态/);assert.doesNotMatch(unknown,/>0\.00</);assert.match(unknown,/入账状态未知/);
});
test('loading, errors and a closed drawer do not expose the previously selected record',()=>{
 for(const p of [{loading:true},{error:'读取失败'},{open:false}])assert.doesNotMatch(render(p),/Demo Merchant|DEMO-TX/);
 assert.match(render({error:'读取失败'}),/重新加载/);
});

test('merchant fields keep source labels, phone-like city, empty values and exact source JSON',()=>{
 const merchantData={description:'Jina AI',categoryCode:null,location:{city:'+493022488295',state:'',country:'De',zip:'019808'}};
 const html=render({transaction:{...base.transaction,merchantData}});
 for(const text of ['商户原始描述 / description','商户类别码 / categoryCode','商户地区','+493022488295, 019808, De'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/柏林|Berlin|href="tel:|商户位置未采集/);
 assert.match(html,/&quot;state&quot;: &quot;&quot;/);
 assert.match(html,/&quot;categoryCode&quot;: null/);
 assert.doesNotMatch(html,/城市 \/ city|州／省 \/ state|邮编 \/ zip|国家 \/ country/);
 const absent=render({transaction:{...base.transaction,merchantData:{location:{}}}});
 assert.doesNotMatch(absent,/&quot;city&quot;/);
});

test('associated card uses name and literal last four; ignores unrelated card data',()=>{
 const transaction={...base.transaction,cardName:'Linked Card',cardLast4:'0012'};
 const html=render({transaction,card:{id:'WRONG-CARD',cardName:'Wrong Name',maskedCardNumber:'**** 9876'}});
 assert.match(html,/Linked Card/);assert.match(html,/•••• 0012/);assert.doesNotMatch(html,/Wrong Name|9876|卡片 ID/);
 const absent=render({transaction:{...base.transaction,cardLast4:'bad'}});
 assert.match(absent,/卡片名称未采集/);assert.match(absent,/尾号未采集/);assert.doesNotMatch(absent,/卡片 ID/);
});
