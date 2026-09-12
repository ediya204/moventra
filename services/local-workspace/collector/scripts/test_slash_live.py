import json
from pathlib import Path
import tempfile
import unittest
import slash_live as live
import slash_preview as s
from test_slash_preview import transaction, batch
from test_slash_cards_export import card

class Client:
    def __init__(self, failure=None, amount=-100):
        self.audit=[]; self.calls=[]; self.failure=failure; self.amount=amount
    def get(self,path,params=None):
        self.calls.append((path,params))
        if self.failure==path or self.failure=='old' and path.startswith('/transaction/'):
            raise s.PreviewError('Synthetic unavailable')
        if path=='/account': return {'items':[{'id':'account_a'}]}
        if path.startswith('/card/'):
            assert params=={'include_pan':'false','include_cvv':'false'}
            return card(path.split('/')[-1])
        if path=='/transaction':
            row=transaction(amount=self.amount); row['date']=s.now()
            return batch([row])
        if path.startswith('/transaction/'):
            return transaction(id=path.split('/')[-1])
        return {'balances':[{'type':'cash','available':{'amountCents':0}}]}

class LiveTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name); self.db=root/'live.sqlite'; self.conf=root/'config.json'
        self.conf.write_text(json.dumps({'enabled':True,'connectionId':'scope','account':{'id':'account_a'},'selectedCards':{'card_a':['latestCreated']}}))
        with live.connect(self.db) as db: live.put_meta(db,{'revision':1,'balances':[{'old':True}]})
    def sync(self,client): live.synchronize(self.conf,self.db,client)
    def test_merchant_roundtrip_and_update_without_duplicate_transaction(self):
        client = Client()
        merchant = {'description': 'Jina AI', 'location': {'city': '+493022488295', 'state': '', 'country': 'De'}}
        original = client.get
        def get(path, params=None):
            result = original(path, params)
            if path == '/transaction':
                result['items'][0]['date'] = '2026-09-06T00:00:00Z'
                result['items'][0]['merchantData'] = merchant
            return result
        client.get = get
        self.sync(client)
        self.sync(client)
        with live.connect(self.db) as db:
            row = json.loads(db.execute("SELECT data FROM live_records WHERE kind='transaction'").fetchone()[0])
            self.assertEqual(row['merchantData'], merchant)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM live_versions WHERE kind='transaction'").fetchone()[0], 1)
        merchant['location']['zip'] = '01234'
        self.sync(client)
        with live.connect(self.db) as db:
            rows = db.execute("SELECT data FROM live_records WHERE kind='transaction'").fetchall()
            self.assertEqual(len(rows), 1)
            row = json.loads(rows[0][0])
            self.assertEqual(row['merchantData'], merchant)
            self.assertEqual(row['amountCents'], '-100')
            self.assertEqual(db.execute("SELECT COUNT(*) FROM live_versions WHERE kind='transaction'").fetchone()[0], 2)
    def test_related_card_tail_is_scoped_whitelisted_and_cached(self):
        client=Client()
        with live.connect(self.db) as db:
            rows=[{'cardId':'card_b'}, {'cardId':'card_c'}]
            changes, errors=live.collect_card_references(db,'scope','account_a',client,rows,limit=1)
            self.assertEqual(len(changes),1)
            self.assertEqual(errors,[])
            kind,row=changes[0]
            self.assertEqual(kind,'card-reference')
            self.assertEqual(set(row),{'id','accountId','last4','cardName','maskedCardNumber','cardStatus','createdAtUTC','cardProductId','virtualAccountId'})
            self.assertEqual(row['cardName'],card('card_b')['name'])
            self.assertRegex(row['last4'],r'^[0-9]{4}$')
            live.put(db,'scope',kind,row,s.now())
            self.assertEqual(live.collect_card_references(db,'scope','account_a',client,rows[:1]),([],[]))
            bad,errors=live.collect_card_references(db,'other','foreign',client,rows[:1])
            self.assertEqual(bad,[])
            self.assertEqual(len(errors),1)
    def test_legacy_reference_upgrade_retains_transaction_and_is_idempotent(self):
        client=Client()
        with live.connect(self.db) as db:
            live.put(db,'scope','card-reference',{'id':'card_b','accountId':'account_a','last4':'1234'},s.now())
            changes,errors=live.collect_card_references(db,'scope','account_a',client,[{'cardId':'card_b'}])
            self.assertEqual(len(changes),1)
            self.assertEqual(errors,[])
            live.put(db,'scope',changes[0][0],changes[0][1],s.now())
            self.assertEqual(live.collect_card_references(db,'scope','account_a',client,[{'cardId':'card_b'}]),([],[]))

    def test_upsert_idempotence_and_exact_source_changes(self):
        client=Client(amount=-9007199254740993)
        # Fixed transaction timestamp to distinguish observation from a changed source.
        original=client.get
        def get(path,params=None):
            result=original(path,params)
            if path=='/transaction': result['items'][0]['date']='2026-09-06T00:00:00Z'
            return result
        client.get=get
        self.sync(client); self.sync(client)
        with live.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM live_records').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM live_versions').fetchone()[0],2)
            row=json.loads(db.execute("SELECT data FROM live_records WHERE kind='transaction'").fetchone()[0])
            self.assertEqual(row['amountCents'],'-9007199254740993')
            self.assertEqual(live.metadata(db)['revision'],3)
        client.amount=-25; self.sync(client)
        with live.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM live_versions').fetchone()[0],3)
    def test_critical_failure_keeps_previous_rows_and_revision(self):
        self.sync(Client())
        with self.assertRaises(s.PreviewError): self.sync(Client('/transaction'))
        with live.connect(self.db) as db:
            self.assertEqual(live.metadata(db)['revision'],2)
            self.assertEqual(live.metadata(db)['state'],'error')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM live_records').fetchone()[0],2)
    def test_card_failure_retains_card_and_does_not_claim_success(self):
        self.sync(Client())
        self.sync(Client('/card/card_a'))
        with live.connect(self.db) as db:
            self.assertEqual(live.metadata(db)['state'],'partial')
            self.assertEqual(db.execute("SELECT COUNT(*) FROM live_records WHERE kind='card'").fetchone()[0],1)
    def test_failed_old_details_rotate_and_dont_starve(self):
        with live.connect(self.db) as db:
            for n in range(25):
                row=s.project(transaction(id=f'old_{n:02}'),'account_a',0,10**15)
                live.put(db,'scope','transaction',row,'2020-01-01T00:00:00Z')
        first=Client('old');self.sync(first)
        second=Client('old');self.sync(second)
        calls=[p for p,_ in second.calls if p.startswith('/transaction/')]
        self.assertIn('/transaction/old_24',calls)
        self.assertEqual(len(calls),20)
    def test_foreign_account_refuses_publish(self):
        client=Client()
        original=client.get
        client.get=lambda p,q=None: {'items':[{'id':'foreign'}]} if p=='/account' else original(p,q)
        with self.assertRaises(s.PreviewError): self.sync(client)
        with live.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM live_records').fetchone()[0],0)
