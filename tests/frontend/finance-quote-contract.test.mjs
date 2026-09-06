import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteUsable} from '../../apps/admin/src/finance/types.ts';
test('fixed quotes use current version, historical quotes use expiry, missing data is invalid',()=>{
 const now=Date.now();
 assert.equal(quoteUsable({mode:'fixed',priceVersion:3,expiresAt:null},3,now),true);
 assert.equal(quoteUsable({mode:'fixed',priceVersion:2,expiresAt:null},3,now),false);
 assert.equal(quoteUsable({expiresAt:new Date(now+1000).toISOString()},3,now),true);
 assert.equal(quoteUsable({expiresAt:new Date(now-1000).toISOString()},3,now),false);
 assert.equal(quoteUsable({expiresAt:null},3,now),false);
 assert.equal(quoteUsable(null,3,now),false);
});
