import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const amounts=uri(compile('../../packages/shared/src/auth/cardSnapshotContract.ts'));
const {transactionQuery,transactionFilterError,collectTransactions,transactionsCsv}=await import(uri(compile('../../apps/client/src/portal/transactionQuery.ts').replace(/from ["']([^"']+)["']/g,()=> 'from '+JSON.stringify(amounts))));
const blank={keyword:'',status:'',from:'',to:''};
test('date boundaries include selected final UTC day and reject invalid ranges',()=>{
 assert.equal(transactionQuery({...blank,from:'2024-02-29',to:'2024-02-29'},0,'r1').get('to'),'2024-03-01T00:00:00.000Z');
 for(const filter of [{from:'2026-02-30'},{from:'2026-09-20',to:'2026-09-19'},{status:'made_up'},{keyword:'a'.repeat(201)},{to:'9999-12-31'}])assert.ok(transactionFilterError({...blank,...filter}));
});
const page=(start,count,total=25,revision='r1')=>({rows:Array.from({length:count},(_,i)=>({id:'tx-'+(start+i)})),total,revision});
test('export starts on page zero and collects every page before returning',async()=>{
 const calls=[],progress=[];const result=await collectTransactions(async p=>{calls.push(p);return p===0?page(0,20):page(20,5)},'r1',(n,total)=>progress.push([n,total]),()=>false);
 assert.deepEqual(calls,[0,1]);assert.equal(result.length,25);assert.deepEqual(progress,[[20,25],[25,25]]);
});
test('export rejects changed versions/counts, duplicate rows, truncation and over-limit data',async()=>{
 for(const second of [page(20,5,25,'r2'),page(20,5,26),page(0,5),page(20,2)])await assert.rejects(collectTransactions(async p=>p===0?page(0,20):second,'r1',()=>{},()=>false));
 await assert.rejects(collectTransactions(async()=>page(0,20,5001),'r1',()=>{},()=>false),/5,000/);
});
test('export cancels after an in-flight response and propagates request failures',async()=>{
 let cancel=false;
 await assert.rejects(collectTransactions(async()=>{cancel=true;return page(0,20)},'r1',()=>{assert.fail('no progress after cancellation')},()=>cancel),/取消/);
 await assert.rejects(collectTransactions(async()=>{throw new Error('offline')},'r1',()=>{},()=>false),/offline/);
});
test('CSV preserves exact amounts, unknown currencies, leading zeros and neutralizes formulas',()=>{
 const csv=transactionsCsv([{id:'t1',merchant:'=HYPERLINK("bad")',cardLast4:'0042',amountCents:'-9007199254740993',originalCurrency:{code:'PHP',amountCents:'118650'},status:'posted',detailedStatus:'settled'},{id:'t2',merchant:'\t+SUM(1,2)'}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/USD −90071992547409\.93/);assert.match(csv,/PHP 118650/);assert.ok(csv.includes('"\'0042"'));assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"\'\t+SUM(1,2)"'));assert.match(csv,/未知/);assert.doesNotMatch(csv,/来源最小单位/);
});
