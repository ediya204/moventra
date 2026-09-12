import {readFileSync} from 'node:fs';
import {openStore,assertLocal} from './store.mjs';
import {NAMESPACE} from './generate.mjs';
import {seedPortal} from './portal.mjs';
import {seedCardAdmin} from './card-admin.mjs';
export function cleanCardAdmin(db,ns){
 assertLocal();db.exec('BEGIN IMMEDIATE');try{
 db.exec('DROP TRIGGER IF EXISTS ca_entries_immutable_delete');
 for(const table of ['ca_unfreeze_requests','ca_freeze_notes','ca_audit','ca_jobs','ca_holds','ca_entries','ca_journals','ca_operations','ca_accounts','ca_cards','ca_principals'])db.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(ns);
 const row=db.prepare('SELECT state_json FROM portal_state WHERE namespace=?').get(ns);
 if(row){const s=JSON.parse(row.state_json);s.cards=s.cards.filter(c=>!c.id.startsWith('CARDOPS-'));for(const c of s.cards)delete c.management;s.entries=s.entries.filter(e=>!e.id.startsWith('CA-'));db.prepare('UPDATE portal_state SET revision=revision+1,state_json=? WHERE namespace=?').run(JSON.stringify(s),ns);}
 db.prepare("DELETE FROM portal_actions WHERE namespace=? AND record_id LIKE 'CA-%'").run(ns);
 db.exec(readFileSync(new URL('./migrations/009_card_administration.sql',import.meta.url),'utf8'));
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]?.endsWith('card-admin-cli.mjs')){
 const command=process.argv[2],db=openStore();
 try{if(command==='init'){seedPortal(db,NAMESPACE);seedCardAdmin(db,NAMESPACE);}else if(command==='clean')cleanCardAdmin(db,NAMESPACE);else if(command!=='status')throw new Error('Use init | clean | status');
 console.log(JSON.stringify(Object.fromEntries(['ca_cards','ca_accounts','ca_operations','ca_entries','ca_holds'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t} WHERE namespace=?`).get(NAMESPACE).n])),null,2));
 }finally{db.close();}
}
