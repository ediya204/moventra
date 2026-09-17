import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../../packages/shared/src/auth/ledgerContract.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {isLedgerReadPath,parseShadowLedger}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const id='10000000-0000-4000-8000-000000000001';
const account='20000000-0000-4000-8000-000000000001';
const fixture=()=>({mode:'shadow',executionEligible:false,authorizationCoverage:'not_integrated',externalReconciliation:'not_checked',reconciliationScope:'local_journal_vs_blnk',reconciliation:'matched',observedAt:'2026-09-17T12:00:00Z',pendingOperations:0,totalsMinor:{USDT:'9007199254740993'},accounts:[{id:account,customerId:id,key:'wallet',kind:'wallet',currency:'USDT',scale:6,postedMinor:'9007199254740993',heldMinor:'1',ledgerAvailableMinor:'9007199254740992'}]});
test('ledger transport accepts exact same-origin customer read paths only',()=>{
 for(const surface of ['client','admin'])assert.equal(isLedgerReadPath(`/${surface}-api/v1/customers/${id}/ledger`),true);
 for(const path of [`/client-api/v1/customers/${id}/ledger?provider=slash`,`/client-api/v1/customers/${id}/ledger/resolve`,`https://evil.invalid/client-api/v1/customers/${id}/ledger`,`/client-api/v1/customers/${'-'.repeat(36)}/ledger`])assert.equal(isLedgerReadPath(path),false);
});
test('shadow monetary contract preserves precision and rejects unsafe or inconsistent data',()=>{
 assert.equal(parseShadowLedger(fixture(),id).totalsMinor.USDT,'9007199254740993');
 for(const mutate of [v=>v.executionEligible=true,v=>v.mode='live',v=>v.totalsMinor.USDT='9007199254740992',v=>v.accounts[0].postedMinor=9007199254740993,v=>v.accounts[0].customerId=account,v=>v.accounts[0].scale=2,v=>v.accounts.push({...v.accounts[0]}),v=>v.accounts[0].heldMinor='1e3',v=>v.accounts[0].ledgerAvailableMinor='0',v=>v.accounts[0].kind='clearing']){
  const v=fixture();mutate(v);assert.throws(()=>parseShadowLedger(v,id));
 }
});
