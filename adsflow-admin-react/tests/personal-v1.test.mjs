import test from 'node:test';
import assert from 'node:assert/strict';
import {retiredTeamPath,assertPersonalAction} from '../src/portal/personalV1.ts';
import {initialState,transition,financeTransition} from '../src/portal/model.ts';
const retired=[{type:'team',name:'x'},{type:'invite',email:'demo@example.com',role:'admin',team:'x'},{type:'finance/transfer',team:'x',direction:'to-main',amount:100},{type:'topup',id:'1001',source:'team',amount:100},{type:'open',name:'x',team:'x'}];
test('V1 model retires team writes including directly called finance transition',()=>{
 const state=initialState(),before=structuredClone(state);
 for(const a of retired){assert.throws(()=>assertPersonalAction(a),e=>e.status===410);assert.throws(()=>transition(state,a,'x','2026-09-07'),/V1/);}
 assert.throws(()=>financeTransition(state,retired[2],'x','2026-09-07'),/V1/);
 assert.deepEqual(state,before);assert.equal('teams' in state,false);assert.equal('members' in state,false);assert.ok(state.cards.every(c=>!('team' in c)));
});
test('V1 legacy links redirect only customer collaboration, never internal staff or pricing groups',()=>{
 for(const p of ['/portal/team','/portal/team/members','/portal/invite/token','/portal/settings/team','/portal/funds/transfer'])assert.equal(retiredTeamPath(p),'/portal/overview');
 for(const p of ['/teams','/teams/x/members','/customers/x/teams','/invitations/abc'])assert.equal(retiredTeamPath(p),'/workbench');
 for(const p of ['/user-groups/groups','/system/access','/card-operations','/finance/withdrawals','/customers/x','/portal/cards','/portal/settings'])assert.equal(retiredTeamPath(p),null);
});

test('personal card funding preserves historical ownership and isolated balances',()=>{
 const s=initialState();
 s.teams=['historical'];s.members=[{team:'historical',email:'demo@example.com'}];s.finance.subBalances={historical:12345};
 const before=structuredClone(s),card=s.cards[0];
 const next=transition(s,{type:'topup',id:card.id,amount:100},'V1-TOPUP','2026-09-07');
 assert.equal(next.balance,before.balance-100);assert.equal(next.cards[0].balance,card.balance+100);
 assert.deepEqual(next.teams,s.teams);assert.deepEqual(next.members,s.members);assert.deepEqual(next.finance.subBalances,s.finance.subBalances);
 assert.deepEqual(s,before);
 assert.throws(()=>transition(s,{type:'topup',id:'FOREIGN',amount:100},'V1-X','2026-09-07'),/不存在/);
});
