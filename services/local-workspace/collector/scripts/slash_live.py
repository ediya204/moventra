#!/usr/bin/env python3
"""Persist the selected Slash scope for the existing local admin; one GET-only sync."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import sys
import uuid
import slash_preview as s
from slash_cards_export import card_projection, csv_row

CONFIG = s.DATA / 'live-config.json'
DB = s.DATA / 'live.sqlite'


def connect(path=DB):
    db = sqlite3.connect(path, timeout=10)
    db.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS live_meta(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_records(connection_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,
      data TEXT NOT NULL,hash TEXT NOT NULL,observed_at TEXT NOT NULL,date_ms INTEGER,status TEXT,
      PRIMARY KEY(connection_id,kind,id));
    CREATE INDEX IF NOT EXISTS live_page ON live_records(connection_id,kind,date_ms DESC,id);
    CREATE TABLE IF NOT EXISTS live_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,connection_id TEXT NOT NULL,
      kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,observed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_refresh_attempts(connection_id TEXT, id TEXT, attempted_at TEXT, PRIMARY KEY(connection_id,id));
    CREATE TABLE IF NOT EXISTS live_runs(id TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL);
    ''')
    return db


def metadata(db):
    r = db.execute('SELECT data FROM live_meta WHERE id=1').fetchone()
    return json.loads(r[0]) if r else {'revision': 0}


def put_meta(db, data):
    db.execute('INSERT INTO live_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (s.dump(data),))


def put(db, scope, kind, row, observed_at):
    encoded = s.dump(row)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    old = db.execute('SELECT hash FROM live_records WHERE connection_id=? AND kind=? AND id=?', (scope, kind, row['id'])).fetchone()
    if not old or old[0] != digest:
        db.execute('INSERT INTO live_versions(connection_id,kind,id,data,observed_at) VALUES(?,?,?,?,?)', (scope,kind,row['id'],encoded,observed_at))
    try:
        date_ms = s.millis(row.get('date') if kind == 'transaction' else row.get('createdAtUTC'))
    except (ValueError, TypeError):
        date_ms = None
    db.execute('''INSERT INTO live_records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,kind,id)
      DO UPDATE SET data=excluded.data,hash=excluded.hash,observed_at=excluded.observed_at,date_ms=excluded.date_ms,status=excluded.status''',
      (scope,kind,row['id'],encoded,digest,observed_at,date_ms,row.get('status',row.get('cardStatus'))))


def initialize(folder):
    if CONFIG.exists():
        print('Live scope already configured; preserved existing data and selection.')
        return
    export = json.loads((folder/'cards-sanitized.json').read_text())
    evidence = json.loads((folder/'export-evidence.json').read_text())
    groups = {}
    cards = {}
    for name in ['latestCreated','recentConsumption']:
        if len(export[name]) != 20:
            raise s.PreviewError('Expected the approved 20-card export in each group.')
        for card in export[name]:
            if card['accountId'] != evidence['accountId']:
                raise s.PreviewError('Export account mismatch.')
            groups.setdefault(card['cardId'], []).append(name)
            cards[card['cardId']] = dict(card, id=card['cardId'])
    with sqlite3.connect('file:'+str(s.DATA/'preview.sqlite')+'?mode=ro',uri=True) as source:
        r=source.execute('SELECT meta FROM runs WHERE id=? AND state=?',(evidence['sourcePreviewRun'],'ready')).fetchone()
        if not r: raise s.PreviewError('Source preview is missing.')
        old=json.loads(r[0])
        transactions=[json.loads(x[0]) for x in source.execute('SELECT data FROM records WHERE run_id=?',(old['runId'],))]
    config={'connectionId':evidence['connectionId'],'account':old['account'],'selectedCards':groups,
        'authorizedActors':['demo-operator'],'syncMode':'manual','intervalSeconds':None,'enabled':True,
        'selectionAt':evidence['generatedAt'],'namespace':'slash-clearing-v1'}
    db=connect()
    with db:
        for id,card in cards.items():
            card['groups']=groups[id]
            put(db,config['connectionId'],'card',card,card['collectedAtUTC'])
        for row in transactions: put(db,config['connectionId'],'transaction',row,old['completedAt'])
        put_meta(db,{'revision':1,'account':old['account'],'connectionId':config['connectionId'],
            'lastSuccessAt':None,'lastObservedAt':old['completedAt'],'state':'imported',
            'balances':old['balances'],'balanceState':old['balanceState'],'coverage':old['coverage'],
            'errors':[],'selectionAt':evidence['generatedAt']})
    db.close()
    with CONFIG.open('x') as f: f.write(s.dump(config)+'\n')
    print(s.dump({'importedCards':len(cards),'importedTransactions':len(transactions),'syncMode':'manual'}))


def collect_card_references(db, scope, account, client, rows, selected=(), limit=20):
    """Bounded enrichment for related cards, separate from the fixed card selection."""
    changes, errors, seen = [], [], set(selected)
    attempted = 0
    for row in sorted(rows, key=lambda r: r.get('date') or '', reverse=True):
        cid = row.get('cardId')
        if not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', cid) or cid in seen:
            continue
        seen.add(cid)
        if db.execute("SELECT 1 FROM live_records WHERE connection_id=? AND id=? AND (kind='card' OR (kind='card-reference' AND json_extract(data,'$.cardName') IS NOT NULL))", (scope, cid)).fetchone():
            continue
        if attempted >= limit: break
        attempted += 1
        try:
            source = client.get('/card/'+cid, {'include_pan':'false','include_cvv':'false'})
            safe = card_projection(source, account, cid)
            masked = safe.get('maskedCardNumber')
            if not masked: raise s.PreviewError('Card last four unavailable.')
            changes.append(('card-reference', {'id':cid, 'accountId':account, 'last4':masked[-4:],
                'cardName':safe.get('name'), 'maskedCardNumber':masked, 'cardStatus':safe.get('status'),
                'createdAtUTC':safe.get('createdAt'), 'cardProductId':safe.get('cardProductId'),
                'virtualAccountId':safe.get('virtualAccountId')}))
        except s.PreviewError as exc:
            errors.append({'kind':'card-reference','id':cid,'message':str(exc)})
    return changes, errors


def synchronize(config_path=CONFIG, db_path=DB, client=None):
    config=json.loads(config_path.read_text())
    if not config['enabled']: return
    db=connect(db_path)
    scope=config['connectionId']; account=config['account']['id']
    started=s.now(); run=str(uuid.uuid4())
    with db:
        m=metadata(db);m.update(state='syncing',startedAt=started,lastAttemptAt=started)
        put_meta(db,m)
    try:
        if client is None: client=s.Slash(*s.config(s.ROOT/'.env.slash.local'))
        discovered=client.get('/account')
        if not any(a.get('id')==account for a in discovered.get('items',[])):
            raise s.PreviewError('Selected account is no longer accessible.')
        end=int(datetime.now(timezone.utc).timestamp()*1000)
        start=end-30*86400000
        changes=[];errors=[]
        for id,groups in config['selectedCards'].items():
            try:
                source=client.get('/card/'+id,{'include_pan':'false','include_cvv':'false'})
                row=csv_row(card_projection(source,account,id),0,scope)
                row.update(id=id,groups=groups)
                row.pop('collectedAtUTC',None)  # observation time belongs outside immutable source content
                changes.append(('card',row))
            except s.PreviewError as exc: errors.append({'kind':'card','id':id,'message':str(exc)})
        rows,_,coverage=s.collect(client,account,start,end,max_pages=50)
        changes.extend(('transaction',r) for r in rows)
        references, reference_errors = collect_card_references(db,scope,account,client,rows,config['selectedCards'])
        changes.extend(references)
        errors.extend(reference_errors)
        seen={r['id'] for r in rows}
        # Refresh up to 20 older observations each run, oldest first. This includes
        # pending AND posted rows so historical corrections can be observed eventually.
        older=db.execute("SELECT id FROM live_records WHERE connection_id=? AND kind='transaction' ORDER BY COALESCE((SELECT attempted_at FROM live_refresh_attempts a WHERE a.connection_id=live_records.connection_id AND a.id=live_records.id),observed_at),id",(scope,)).fetchall()
        refreshed=0;attempted=[]
        for (id,) in older:
            if id in seen: continue
            try:
                source=client.get('/transaction/'+id)
                if source.get('id')!=id: raise s.PreviewError('Transaction identifier mismatch.')
                changes.append(('transaction',s.project(source,account,start,end)))
            except s.PreviewError as exc: errors.append({'kind':'transaction','id':id,'message':str(exc)})
            attempted.append(id)
            refreshed+=1
            if refreshed>=20: break
        new_balances=None
        try: new_balances=s.balances(client.get('/account/'+account+'/balance'))
        except s.PreviewError as exc: errors.append({'kind':'balance','message':str(exc)})
        completed=s.now()
        with db:
            for kind,row in changes: put(db,scope,kind,row,completed)
            for id in attempted: db.execute('INSERT INTO live_refresh_attempts VALUES(?,?,?) ON CONFLICT(connection_id,id) DO UPDATE SET attempted_at=excluded.attempted_at',(scope,id,completed))
            m=metadata(db)
            m.update(revision=m['revision']+1,state='partial' if errors else 'updated',
                lastObservedAt=completed,lastCompletedAt=completed,errors=errors,coverage=coverage,
                olderRefreshed=refreshed,sourceSnapshotGuaranteed=False)
            if not errors: m['lastSuccessAt']=completed
            if new_balances is not None:
                m.update(balances=new_balances,balanceObservedAt=completed,balanceState='fetched_currency_unverified')
            else: m['balanceState']='stale_error'
            put_meta(db,m)
            db.execute('INSERT INTO live_runs VALUES(?,?,?)',(run,m['state'],s.dump({'startedAt':started,'completedAt':completed,'audit':client.audit,'coverage':coverage,'errors':errors})))
        print(s.dump({'state':m['state'],'revision':m['revision'],'updatedRecords':len(changes),'errors':len(errors)}),flush=True)
    except s.PreviewError as exc:
        with db:
            m=metadata(db);m.update(state='error',lastCompletedAt=s.now(),errors=[{'message':str(exc)}])
            put_meta(db,m)
            db.execute('INSERT INTO live_runs VALUES(?,?,?)',(run,'error',s.dump({'startedAt':started,'error':str(exc),'audit':client.audit if client else []})))
        raise
    finally: db.close()


def enrich_references(limit=20, config_path=CONFIG, db_path=DB, client=None):
    """Explicit manual repair; never refresh transactions, balances or the fixed selection."""
    if not 1 <= limit <= 200: raise s.PreviewError('Limit must be between 1 and 200.')
    config=json.loads(config_path.read_text())
    if not config['enabled']: raise s.PreviewError('Live connection is disabled.')
    scope=config['connectionId']; account=config['account']['id']
    if client is None: client=s.Slash(*s.config(s.ROOT/'.env.slash.local'))
    db=connect(db_path)
    try:
        rows=[json.loads(r[0]) for r in db.execute("SELECT data FROM live_records WHERE connection_id=? AND kind='transaction' ORDER BY date_ms DESC",(scope,))]
        changes,errors=collect_card_references(db,scope,account,client,rows,config['selectedCards'],limit)
        completed=s.now()
        with db:
            for kind,row in changes: put(db,scope,kind,row,completed)
            m=metadata(db)
            if changes: m['revision']+=1
            m['cardReferenceEnrichment']={'completedAt':completed,'updated':len(changes),'errors':errors}
            put_meta(db,m)
            db.execute('INSERT INTO live_runs VALUES(?,?,?)',(str(uuid.uuid4()),'reference_enrichment',s.dump({'completedAt':completed,'audit':client.audit,'errors':errors})))
        print(s.dump({'updatedCardReferences':len(changes),'errors':len(errors)}),flush=True)
    finally: db.close()


if __name__=='__main__':
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['init','sync','enrich-references'])
    p.add_argument('--export-dir',type=Path)
    p.add_argument('--limit',type=int,default=20)
    a=p.parse_args()
    try:
        with (s.DATA/'live-sync.lock').open('a') as lock:
            try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise s.PreviewError('A live sync is already running.') from None
            if a.command=='init':
                if not a.export_dir: raise s.PreviewError('Provide --export-dir.')
                initialize(a.export_dir)
            elif a.command=='enrich-references': enrich_references(a.limit)
            else: synchronize()
    except (s.PreviewError,OSError,ValueError,sqlite3.Error) as exc:
        print(str(exc) if isinstance(exc,s.PreviewError) else 'Local live sync failed; details withheld.',file=sys.stderr)
        raise SystemExit(1)
