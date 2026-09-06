import test from 'node:test';
import assert from 'node:assert/strict';
import {minorText,originalText,utcTime,sourceLabel,postingLabels,detailLabels,cardLabels,transactionStatus,transactionRowClass} from '../../apps/admin/src/components/cardTransactionFields.ts';
test('money display preserves exact integer units, zero and missing values',()=>{
 assert.equal(minorText('9007199254740993123'),'90,071,992,547,409,931.23');
 assert.equal(minorText('-10100'),'−101.00');assert.equal(minorText('0'),'0.00');
 assert.equal(minorText(null),'—');assert.equal(minorText('1.5'),'无效金额');assert.equal(minorText('1e3'),'无效金额');
 assert.equal(originalText({code:'CNY',amountCents:'72000'}),'CNY 720.00');
 assert.equal(originalText({code:'AED',amountCents:'36725'}),'AED 367.25');
 assert.equal(originalText({code:'JPY',amountCents:'123'}),'JPY 123（来源最小单位）');
 assert.equal(originalText({code:'USD',amountCents:null}),'—');
});
test('source state dimensions preserve refunds, reversals and unknown values',()=>{
 assert.equal(sourceLabel('pending',postingLabels),'待入账 · pending');
 assert.equal(sourceLabel('refund',detailLabels),'退款 · refund');
 assert.equal(sourceLabel('reversed',detailLabels),'授权已撤销 · reversed');
 assert.equal(sourceLabel('paused',cardLabels),'渠道暂停 · paused');
 assert.equal(sourceLabel('new_state',postingLabels),'未知状态 · new_state');assert.equal(sourceLabel(null,postingLabels),'—');
});
test('UTC dates distinguish missing, invalid and explicit timezone offsets',()=>{
 assert.equal(utcTime(null),'—');assert.equal(utcTime('not-a-date'),'无效时间');
 assert.equal(utcTime('2026-09-07T00:00:00+08:00'),'2026-09-06 16:00:00');
});
test('single transaction status follows source updates without merging refund, reversal and dispute',()=>{
 assert.deepEqual(transactionStatus('pending','pending'),{label:'待入账',color:'warning'});
 assert.deepEqual(transactionStatus('posted','settled'),{label:'已结算',color:'success'});
 assert.deepEqual(transactionStatus('posted','refund'),{label:'已退款',color:'info'});
 assert.deepEqual(transactionStatus('posted','reversed'),{label:'已撤销',color:'info'});
 assert.deepEqual(transactionStatus('failed','declined'),{label:'已拒绝',color:'error'});
 assert.deepEqual(transactionStatus('posted','dispute'),{label:'争议中',color:'error'});
 assert.deepEqual(transactionStatus('pending','refund'),{label:'退款处理中',color:'warning'});
 assert.deepEqual(transactionStatus('pending','settled'),{label:'待核实',color:'warning'});
 assert.match(transactionStatus('posted','new_source_state').label,/未知状态.*new_source_state/);
 assert.notEqual(transactionStatus('new_posting_state','settled').color,'success');
 assert.deepEqual(transactionStatus(null,null),{label:'—',color:'default'});
});

test('row colors follow updates and leave unknown combinations unstyled',()=>{
 assert.equal(transactionRowClass('pending','pending'),'transaction-pending');
 assert.equal(transactionRowClass('failed','declined'),'transaction-error');
 assert.equal(transactionRowClass('posted','reversed'),'transaction-reversed');
 assert.equal(transactionRowClass('posted','settled'),'');
 assert.equal(transactionRowClass('pending','settled'),'');
 assert.equal(transactionRowClass('unknown','reversed'),'');
});
