import json
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import slash_preview as s


START = s.millis('2026-08-01T00:00:00Z')
END = s.millis('2026-09-01T00:00:00Z')


def transaction(id='tx1', amount=-10000, status='posted', **extra):
    return dict(id=id, accountId='account_a', amountCents=amount, status=status,
                detailedStatus='settled', date='2026-08-15T00:00:00Z', **extra)


def project(**kwargs):
    return s.project(transaction(**kwargs), 'account_a', START, END)


class FakeClient:
    def __init__(self, pages):
        self.pages, self.calls = iter(pages), []

    def get(self, path, params):
        self.calls.append((path, params))
        return next(self.pages)


def batch(items, cursor=None):
    return {'items': items, 'metadata': {'nextCursor': cursor}}


class PreviewTests(unittest.TestCase):
    def test_merchant_source_structure_and_no_inference(self):
        merchant = {'description': ' Jina AI ', 'categoryCode': None,
                    'location': {'city': '+493022488295', 'state': '', 'zip': '019808', 'country': 'De'}}
        row = project(merchantData=merchant)
        self.assertEqual(row['merchantData'], merchant)
        self.assertNotIn('merchantData', project())
        self.assertIsNone(project(merchantData=None)['merchantData'])
        for value in ({}, {'location': {}}, {'location': None}):
            self.assertEqual(project(merchantData=value)['merchantData'], value)
        self.assertEqual(project(merchantData={'location': {'city': '650-5434800'}})['merchantData'],
                         {'location': {'city': '650-5434800'}})
        self.assertEqual(s.summary([row])['amountsUSDMinor'], s.summary([project()])['amountsUSDMinor'])

    def test_merchant_invalid_types_and_nested_whitelist(self):
        row = project(merchantData={'description': 'Merchant', 'phone': 'SECRET',
                      'location': {'city': ['SECRET'], 'zip': 123, 'country': 'US', 'coordinates': 'SECRET'}})
        self.assertEqual(row['merchantData'], {'description': 'Merchant', 'location': {'country': 'US'}})
        self.assertNotIn('SECRET', s.dump(row))
        self.assertTrue(any('location.city' in x for x in row['issues']))
        self.assertTrue(any('location.zip' in x for x in row['issues']))
        for value in ([], 123, True):
            self.assertTrue(project(merchantData=value)['issues'])
            self.assertTrue(project(merchantData={'location': value})['issues'])

    def test_precision_zero_and_invalid_money(self):
        self.assertEqual(project(amount=9007199254740993)['amountCents'], '9007199254740993')
        self.assertEqual(s.money('-9007199254740993'), '−90,071,992,547,409.93')
        self.assertEqual(s.money(project(amount=0)['amountCents']), '0.00')
        for invalid in [None, True, '100', Decimal('1.5'), Decimal('NaN'), 10**31]:
            self.assertIsNone(s.minor(invalid))
        self.assertEqual(s.minor(Decimal('1E+10')), '10000000000')

    def test_posted_pending_failed_and_annotations(self):
        rows = [project(), project(id='refund', amount=2500),
                project(id='pending', amount=-9900, status='pending'),
                project(id='failed', amount=3000, status='failed'),
                project(id='fx', amount=-101, fxFeeInfo={'amountCents': 101})]
        totals = s.summary(rows)['amountsUSDMinor']
        self.assertEqual(totals, {'postedOut': '10101', 'postedIn': '2500', 'postedNet': '-7601', 'pendingNet': '-9900'})
        self.assertIsNone(rows[2]['postedAt'])

    def test_half_open_range_and_unknown_date(self):
        for date, expected in [('2026-08-01T00:00:00Z', True),
                               ('2026-09-01T00:00:00Z', False),
                               ('2026-08-15T00:00:00', False), (None, False)]:
            source = transaction()
            source['date'] = date
            row = s.project(source, 'account_a', START, END)
            self.assertEqual(row['inWindow'], expected)
            if not expected:
                self.assertEqual(s.summary([row])['amountsUSDMinor']['postedNet'], '0')

    def test_scope_and_missing_identifier_rejected(self):
        source = transaction()
        with self.assertRaises(s.PreviewError):
            s.project(source, 'different_account', START, END)
        source['id'] = None
        with self.assertRaises(s.PreviewError):
            s.project(source, 'account_a', START, END)

    def test_unknown_and_missing_values_not_succeeded_or_zero(self):
        row = project(amount=None, status='future_enum')
        self.assertEqual(row['status'], 'future_enum')
        self.assertIsNone(row['amountCents'])
        self.assertGreater(len(row['issues']), 0)
        self.assertEqual(s.summary([row])['amountsUSDMinor']['postedNet'], '0')

    def test_posted_reversed_preserves_source_and_flags_review(self):
        source = transaction()
        source['detailedStatus'] = 'reversed'
        row = s.project(source, 'account_a', START, END)
        self.assertEqual((row['status'], row['detailedStatus']), ('posted', 'reversed'))
        self.assertTrue(any('状态组合' in issue for issue in row['issues']))
        self.assertEqual(s.summary([row])['counts']['statusReview'], 1)

    def test_sensitive_nested_fields_dropped(self):
        row = project(pan='SECRET-PAN', cvv='SECRET-CVV', otp='SECRET-OTP',
                      merchantData={'description': 'Merchant', 'secret': 'SECRET-MERCHANT'},
                      originalCurrency={'code': 'EUR', 'amountCents': -500,
                                        'conversionRate': Decimal('1.10000000000000001'), 'secret': 'SECRET-FX'})
        encoded = s.dump(row)
        self.assertNotIn('SECRET', encoded)
        self.assertEqual(row['originalCurrency']['conversionRate'], '1.10000000000000001')

    def test_dedup_and_changed_observation_without_double_count(self):
        client = FakeClient([batch([transaction()], 'next'),
                             batch([transaction(), transaction(amount=-8000)])])
        rows, observations, coverage = s.collect(client, 'account_a', START, END)
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(observations), 3)
        self.assertEqual(s.summary(rows)['amountsUSDMinor']['postedNet'], '-8000')
        self.assertEqual(coverage['duplicates'], 2)
        self.assertEqual(coverage['changedDuringFetch'], 1)
        self.assertTrue(coverage['cursorExhausted'])
        self.assertFalse(coverage['complete'])
        self.assertEqual(client.calls[0][1]['filter:to_date'], str(END - 1))

    def test_page_limit_and_repeated_cursor(self):
        client = FakeClient([batch([transaction()], 'next')])
        _, _, coverage = s.collect(client, 'account_a', START, END, max_pages=1)
        self.assertFalse(coverage['cursorExhausted'])
        self.assertEqual(coverage['reason'], 'page_limit')
        client = FakeClient([batch([], 'same'), batch([], 'same')])
        with self.assertRaises(s.PreviewError):
            s.collect(client, 'account_a', START, END)

    def test_malformed_page_not_empty_success(self):
        for payload in [{'items': []}, {'items': 'invalid'}, None]:
            with self.assertRaises(s.PreviewError):
                s.collect(FakeClient([payload]), 'account_a', START, END)

    def test_official_omitted_cursor_means_end(self):
        client = FakeClient([{'items': [transaction()], 'metadata': {'count': 1}}])
        rows, _, coverage = s.collect(client, 'account_a', START, END)
        self.assertEqual(len(rows), 1)
        self.assertTrue(coverage['cursorExhausted'])

    def test_balance_types_never_sum_or_invent_currency(self):
        result = s.balances({'balances': [
            {'type': 'cash', 'available': {'amountCents': 0}, 'posted': {'amountCents': 10}},
            {'type': 'credit', 'available': {'amountCents': 20000}}]})
        self.assertEqual(result[0]['availableCents'], '0')
        self.assertIsNone(result[1]['postedCents'])
        self.assertTrue(all(b['currency'] is None for b in result))
        with self.assertRaises(s.PreviewError):
            s.balances({'error': 'not a balance'})

    def test_upstream_write_or_url_blocked_before_network(self):
        client = s.Slash('fake-test-key')
        with patch.object(client.opener, 'open') as opened:
            for path in ['/card/a', '/transfers/book-transfer', '//evil.test/account',
                         'https://evil.test/account', '/account/a/../balance', '/account/a%2fb/balance']:
                with self.assertRaises(s.PreviewError):
                    client.get(path)
            with self.assertRaises(s.PreviewError):
                client.get('/account', {'url': 'https://evil.test'})
            with self.assertRaises(s.PreviewError):
                client.get('/card/a', {'include_pan': 'true', 'include_cvv': 'false'})
            opened.assert_not_called()
        self.assertIsNone(s.NoRedirect().redirect_request(None))

    def test_card_catalog_get_only_and_query_allowlist(self):
        client = s.Slash('fake-test-key')
        with patch.object(client.opener, 'open') as opened:
            response = opened.return_value
            response.code = 200
            response.read.return_value = b'{"items": [], "metadata": {}}'
            client.get('/card-product', {'cursor': 'next-page'})
            req = opened.call_args.args[0]
            self.assertEqual(req.method, 'GET')
            self.assertEqual(req.full_url, s.BASE + '/card-product?cursor=next-page')
            self.assertIsNone(req.data)
            opened.reset_mock()
            with self.assertRaises(s.PreviewError):
                client.get('/card-product', {'include_pan': 'true'})
            opened.assert_not_called()

    def test_repeat_import_and_connections_remain_isolated(self):
        with tempfile.TemporaryDirectory() as temp:
            db = s.open_store(Path(temp))
            meta = {'connectionId': 'connection_a'}
            first = s.save_run(db, meta, [project()], [])
            second = s.save_run(db, meta, [project()], [])
            third = s.save_run(db, {'connectionId': 'connection_b'}, [project(amount=-8000)], [])
            self.assertEqual(first['summary'], second['summary'])
            self.assertNotEqual(second['runId'], third['runId'])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records WHERE run_id=?', (second['runId'],)).fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM runs').fetchone()[0], 3)
            db.close()

    def test_html_escapes_source_and_limits_to_50(self):
        with tempfile.TemporaryDirectory() as temp:
            db = s.open_store(Path(temp))
            rows = [project(id='tx%03d' % i, merchantData={'description': '<script>bad()</script>'}) for i in range(51)]
            meta = {'connectionId': 'a', 'account': {'name': 'Example', 'type': 'charge_card', 'id': 'account_a'},
                'balanceState': 'unavailable', 'balances': [], 'coverage': {'pages': 1, 'cursorExhausted': True,
                    'duplicates': 0, 'changedDuringFetch': 0}, 'from': '2026-08-01', 'to': '2026-09-01',
                'completedAt': '2026-09-01'}
            saved = s.save_run(db, meta, rows, [])
            rendered = s.page(db, {}, '/private/').decode()
            self.assertNotIn('<script>', rendered)
            self.assertIn('&lt;script&gt;', rendered)
            self.assertEqual(rendered.count('<summary>查看字段</summary>'), 50)
            self.assertIn('共 51 条', rendered)
            self.assertIn(saved['runId'], rendered)
            second = s.page(db, {'page': ['2'], 'run': [saved['runId']]}, '/private/').decode()
            self.assertEqual(second.count('<summary>查看字段</summary>'), 1)
            empty = s.page(db, {'q': ['absent']}, '/private/').decode()
            self.assertIn('当前筛选没有记录', empty)
            with self.assertRaises(s.PreviewError):
                s.page(db, {'unsupported': ['value']}, '/private/')
            db.close()

    def test_failed_attempt_preserves_snapshot_and_marks_stale(self):
        with tempfile.TemporaryDirectory() as temp:
            db = s.open_store(Path(temp))
            meta = {'connectionId': 'a', 'account': {'name': 'Example', 'type': 'charge_card', 'id': 'a'},
                'balanceState': 'unavailable', 'balances': [], 'coverage': {'pages': 1, 'cursorExhausted': True,
                    'duplicates': 0, 'changedDuringFetch': 0}, 'from': 'a', 'to': 'b', 'completedAt': 'c'}
            s.save_run(db, meta, [project()], [])
            db.execute('INSERT INTO runs VALUES(?,?,?)', ('failure', 'failed', '{}'))
            self.assertIn('最近一次导入失败', s.page(db, {}, '/private/').decode())
            db.close()


if __name__ == '__main__':
    unittest.main()
