#!/usr/bin/env python3
"""Explicit, read-only export of an existing sanitized local Slash cache.
No network, no secrets and no customer-ownership inference. Output is PRIVATE.
"""
import argparse,json,os,re,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--output',required=True);a=p.parse_args()
allowed=['id','accountId','cardId','status','detailedStatus','date','authorizedAt','postedAt','merchant','categoryCode','amountCents','originalCurrency','merchantData']
with sqlite3.connect('file:'+str(Path(a.database).resolve())+'?mode=ro',uri=True) as db:
 db.execute('BEGIN')
 meta=json.loads(db.execute('SELECT data FROM live_meta WHERE id=1').fetchone()[0]);scope=meta['connectionId'];account=meta['account']['id']
 source=db.execute('SELECT kind,data FROM live_records WHERE connection_id=? ORDER BY kind,id',(scope,)).fetchall()
 cards={}
 for kind,raw in source:
  if kind not in ('card','card-reference'):continue
  row=json.loads(raw)
  if row.get('accountId')!=account:raise ValueError('card scope mismatch')
  tail=row.get('last4') or row.get('cardLast4');masked=row.get('maskedCardNumber')
  if not tail and isinstance(masked,str):
   m=re.fullmatch(r'(?:\*{4}|•{4}) ([0-9]{4})',masked);tail=m.group(1) if m else None
  cards[row['id']]={'id':row['id'],'accountId':account,'cardName':row.get('cardName') or row.get('name'),'last4':tail,'cardStatus':row.get('cardStatus'),'createdAtUTC':row.get('createdAtUTC')}
 records=[{'kind':'card','data':r} for r in cards.values()]
 for kind,raw in source:
  if kind!='transaction':continue
  row=json.loads(raw)
  if not row.get('cardId'):continue
  if row.get('accountId')!=account:raise ValueError('transaction scope mismatch')
  result={k:row[k] for k in allowed if k in row}
  card=cards.get(row['cardId'],{});result.update(cardName=card.get('cardName'),cardLast4=card.get('last4'))
  records.append({'kind':'transaction','data':result})
 bundle={'connectionId':scope,'accountId':account,'label':'Slash · 卡交易只读','sourceAt':meta['lastObservedAt'],'records':sorted(records,key=lambda x:(x['kind'],x['data']['id']))}
 fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(bundle,f,ensure_ascii=False)
 print(json.dumps({'cards':len(cards),'transactions':len(records)-len(cards),'sourceAt':bundle['sourceAt'],'complete':False}))
