import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../../packages/shared/src/auth/cardSnapshotContract.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {cardQuotaDisplay}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const metric={currency:'USD',scale:2,availability:'available',availableMinor:'100',cycleSpendMinor:'1900',totalLimitMinor:'2000',spendingMinor:'999999',sharedGroup:false};
test('quota uses same-period provider values, not rolling spending',()=>{
 assert.deepEqual(cardQuotaDisplay(metric),{remaining:'USD 1.00',used:'USD 19.00',total:'USD 20.00',percent:95});
 assert.equal(cardQuotaDisplay({...metric,totalLimitMinor:'2500'}).percent,null);
});
test('unknown, shared limits and invalid values cannot fabricate progress',()=>{
 assert.equal(cardQuotaDisplay().remaining,'待同步');
 for(const availableMinor of [null,undefined,'-1','1e3'])assert.equal(cardQuotaDisplay({...metric,availableMinor}).percent,null);
 assert.equal(cardQuotaDisplay({...metric,cycleSpendMinor:undefined}).used,'未提供');
 assert.equal(cardQuotaDisplay({...metric,sharedGroup:true}).total,'未提供');
 assert.equal(cardQuotaDisplay({...metric,sharedGroup:true}).percent,null);
 assert.equal(cardQuotaDisplay({...metric,currency:'EUR'}).remaining,'未提供');
 assert.equal(cardQuotaDisplay({...metric,scale:6}).percent,null);
});
test('zero and large minor amounts retain exact precision',()=>{
 assert.equal(cardQuotaDisplay({...metric,availableMinor:'0',cycleSpendMinor:'2000'}).percent,100);
 assert.equal(cardQuotaDisplay({...metric,availableMinor:'2000',cycleSpendMinor:'0'}).percent,0);
 assert.equal(cardQuotaDisplay({...metric,totalLimitMinor:'0',availableMinor:'0',cycleSpendMinor:'0'}).percent,null);
 const out=cardQuotaDisplay({...metric,totalLimitMinor:'9007199254740994',cycleSpendMinor:'9007199254740993',availableMinor:'1'});
 assert.equal(out.used,'USD 90071992547409.93');assert.equal(out.remaining,'USD 0.01');assert.equal(out.percent,99.99);
});
