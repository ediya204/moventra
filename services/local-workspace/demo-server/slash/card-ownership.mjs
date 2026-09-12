import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function cardOwner(db,namespace,platform,connection,cardId){
 const row=db&&cardId?db.prepare(`SELECT u.id,u.name,u.email,b.revision,b.actor,b.reason,b.updated_at
 FROM internal_card_owners b JOIN mg_users u ON u.namespace=b.namespace AND u.id=b.user_id
 WHERE b.namespace=? AND b.platform=? AND b.connection_id=? AND b.card_id=?`).get(namespace,platform,connection,cardId):null;
 return {platform,customerId:row?.id??null,customerName:row?.name??null,email:row?.email??null,
  ownershipStatus:row?'bound':'unbound',ownershipSource:'internal_database',ownershipRevision:row?.revision??0,
  ownershipActor:row?.actor??null,ownershipReason:row?.reason??null,ownershipUpdatedAt:row?.updated_at??null};
}
export function bindCardOwner(db,namespace,platform,connection,cardId,actor,body){
 if(actor!=='demo-operator')fail('没有内部卡片归属维护权限',403);
 if(!body||Object.keys(body).some(k=>!['userId','revision','reason'].includes(k))||typeof body.userId!=='string'||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500||!Number.isInteger(body.revision)||body.revision<0)fail('用户、当前版本及绑定原因必填');
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('SELECT 1 FROM mg_users WHERE namespace=? AND id=?').get(namespace,body.userId))fail('内部用户不存在',404);
  const old=cardOwner(db,namespace,platform,connection,cardId);
  if(old.customerId===body.userId){db.exec('COMMIT');return old;}
  if(old.ownershipRevision!==body.revision)fail('归属已更新，请刷新后重试',409);
  const time=new Date().toISOString();
  db.prepare(`INSERT INTO internal_card_owners VALUES(?,?,?,?,?,?,?,?,?)
   ON CONFLICT(namespace,platform,connection_id,card_id) DO UPDATE SET user_id=excluded.user_id,revision=excluded.revision,actor=excluded.actor,reason=excluded.reason,updated_at=excluded.updated_at`)
   .run(namespace,platform,connection,cardId,body.userId,old.ownershipRevision+1,actor,body.reason.trim(),time);
  db.prepare('INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)').run(namespace,randomUUID(),actor,'card.ownership.bind',cardId,JSON.stringify({platform,connection,previousUserId:old.customerId,userId:body.userId,reason:body.reason.trim()}),time);
  const result=cardOwner(db,namespace,platform,connection,cardId);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
