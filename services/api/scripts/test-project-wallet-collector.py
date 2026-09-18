import copy
import decimal
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).with_name('collect-project-wallet.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class CollectorTest(unittest.TestCase):
    def source(self, path, query):
        if path.startswith('/virtual-account/'):
            return {'virtualAccount':{'id':'va','accountId':'a','name':'Wallet','accountType':'default'}}
        if path=='/card':
            return {'items':[{'id':'c','accountId':'a','virtualAccountId':'va','pan':'MUST_NOT_EXPORT','cvv':'NO'}], 'metadata':{}}
        return {'items':[{'id':'t','accountId':'a','virtualAccountId':'va','cardId':'c','amountCents':-9007199254740993,'date':'2026-09-18T00:00:00Z','memo':'PRIVATE','pan':'NO'}, {'id':'other','accountId':'a','virtualAccountId':'else','cardId':'c','amountCents':1}], 'metadata':{}}
    def test_precision_scope_redaction(self):
        b,m=c.collect(self.source,'conn','a','va','Wallet',['c'])
        self.assertEqual(m['cardTransactions'],1)
        self.assertEqual(m['excludedRecords'],1)
        self.assertEqual(b['records'][1]['data']['amountCents'],'-9007199254740993')
        self.assertNotIn('pan',str(b));self.assertNotIn('memo',str(b));self.assertNotIn('cvv',str(b))
    def test_changed_roster(self):
        with self.assertRaises(ValueError):c.collect(self.source,'conn','a','va','Wallet',['c','new'])
    def test_repeated_cursor(self):
        def source(p,q):
            r=self.source(p,q)
            if p=='/card':r['metadata']['nextCursor']='repeat'
            return r
        with self.assertRaises(ValueError):c.collect(source,'conn','a','va','Wallet',['c'])
    def test_nonintegral_money(self):
        with self.assertRaises(ValueError):c.money(decimal.Decimal('1.1'))
    def test_wallet_mismatch(self):
        with self.assertRaises(ValueError):c.collect(self.source,'conn','a','wrong','Wallet',['c'])

unittest.main()
