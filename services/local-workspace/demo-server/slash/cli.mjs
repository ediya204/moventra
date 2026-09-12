import {openStore,importDemo,cleanDemo,rollback,counts} from './store.mjs';
import {portalState} from './portal.mjs';
import {NAMESPACE} from './generate.mjs';
import {seedManagement} from './management.mjs';
import {seedBins} from './bins.mjs';
const args=process.argv.slice(2),command=args.shift()||'import';
const option=(key,fallback)=>{const i=args.indexOf(`--${key}`);return i<0?fallback:args[i+1];};
const namespace=option('namespace',NAMESPACE);const db=openStore();
try{
 if(command==='import'){const result=importDemo(db,{namespace,seed:Number(option('seed',20260906)),replicas:Number(option('replicas',1)),batchSize:Number(option('batch-size',20))});const client=portalState(db,namespace);seedBins(db,namespace);console.log(JSON.stringify({...result,binProducts:db.prepare('SELECT count(*) n FROM bin_products WHERE namespace=?').get(namespace).n,client:{cards:client.cards.length,transactions:client.entryCount,financeOrders:client.finance.orders.length,revision:client.revision}},null,2));}
 else if(command==='clean'){cleanDemo(db,namespace);console.log(`Cleaned only namespace ${namespace}`);}
 else if(command==='portal-reset'){db.exec('BEGIN IMMEDIATE');try{for(const table of ['bin_card_links','portal_actions','portal_state'])db.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(namespace);db.exec('COMMIT');console.log('Reset only local client workflow: '+namespace);}catch(e){db.exec('ROLLBACK');throw e;}}
 else if(command==='rollback'){rollback(db);console.log('Local Demo schema rolled back');}
 else if(command==='management-init'){if(!db.prepare('SELECT namespace FROM demo_batches WHERE namespace=?').get(namespace))importDemo(db,{namespace});seedManagement(db,namespace);console.log(JSON.stringify({namespace,groups:db.prepare('SELECT count(*) n FROM mg_groups WHERE namespace=?').get(namespace).n,users:db.prepare('SELECT count(*) n FROM mg_users WHERE namespace=?').get(namespace).n},null,2));}
 else if(command==='management-clean'){db.exec('BEGIN IMMEDIATE');try{for(const table of ['mg_settings','mg_groups','mg_fees','mg_audit','mg_sessions'])db.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(namespace);db.exec('COMMIT');console.log('Removed only local management data: '+namespace);}catch(e){db.exec('ROLLBACK');throw e;}}
 else if(command==='status')console.log(JSON.stringify(counts(db,namespace),null,2));
 else throw new Error('Commands: import | clean | status | portal-reset | management-init | management-clean | rollback');
}finally{db.close();}
