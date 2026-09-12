import csv
import json
from pathlib import Path
import tempfile
import unittest

import slash_cards_export as c
import slash_preview as s
from test_slash_preview import FakeClient, batch, project


def card(id='card_a', date='2026-09-01T00:00:00Z', **extra):
    return dict(id=id, accountId='account_a', createdAt=date, last4='0012', name='Example', **extra)


class CardExportTests(unittest.TestCase):
    def test_card_sensitive_fields_never_retained(self):
        row = c.card_projection(card(pan='PAN-SECRET', cvv='CVV-SECRET', userData={'secret': 'SECRET'}), 'account_a')
        self.assertNotIn('SECRET', s.dump(row))
        self.assertEqual(row['maskedCardNumber'], '**** 0012')
        with self.assertRaises(s.PreviewError):
            c.card_projection(card(), 'different_account')
        with self.assertRaises(s.PreviewError):
            c.card_projection(card(), 'account_a', 'different_card')

    def test_latest_creation_descending_and_unique(self):
        client = FakeClient([batch([card('a')], 'next'),
                             batch([card('a'), card('b', date='2026-08-01T00:00:00Z')])])
        rows, evidence = c.latest_created(client, 'account_a', 2)
        self.assertEqual([r['id'] for r in rows], ['a', 'b'])
        self.assertEqual(evidence['pages'], 2)
        self.assertEqual(client.calls[0][1]['sortDirection'], 'DESC')
        client = FakeClient([batch([card('older', date='2026-08-01T00:00:00Z'), card('newer')])])
        rows, evidence = c.latest_created(client, 'account_a', 2)
        self.assertEqual([r['id'] for r in rows], ['newer', 'older'])
        self.assertEqual(evidence['observedSortInversions'], 1)
        self.assertTrue(evidence['inventoryCursorExhausted'])

    def test_sort_anomaly_requires_full_pagination_not_first_100(self):
        client = FakeClient([batch([card('pinned', date='2026-01-01T00:00:00Z'), card('newer')], 'next'),
                             batch([card('third', date='2026-08-31T00:00:00Z')])])
        rows, evidence = c.latest_created(client, 'account_a', 2)
        self.assertEqual([r['id'] for r in rows], ['newer', 'third'])
        self.assertEqual(evidence['pages'], 2)
        self.assertEqual(evidence['scannedCards'], 3)

    def test_consumption_is_unique_posted_settled_negative(self):
        rows = [project(id='old', cardId='card1'), project(id='new', cardId='card1'),
                project(id='card2', cardId='card2'), project(id='pending', cardId='card3', status='pending'),
                project(id='refund', cardId='card4', amount=100), project(id='zero', cardId='card5', amount=0)]
        rows[1]['date'] = '2026-08-16T00:00:00Z'
        reversed_row = project(id='reversed', cardId='card6')
        reversed_row['detailedStatus'] = 'reversed'
        rows.append(reversed_row)
        selected = c.most_recent_consumption(rows)
        self.assertEqual([r['cardId'] for r in selected], ['card1', 'card2'])
        self.assertEqual(selected[0]['id'], 'new')

    def test_csv_formula_neutralization_and_exact_amount(self):
        source = card()
        source['name'] = '=HYPERLINK("https://example.com")'
        row = c.csv_row(c.card_projection(source, 'account_a'), 1, 'connection', project(amount=-9007199254740993))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'cards.csv'
            c.write_csv(path, [row])
            with path.open(encoding='utf-8-sig', newline='') as f:
                actual = next(csv.DictReader(f))
            self.assertTrue(actual['cardName'].startswith("'="))
            self.assertEqual(actual['lastConsumptionUSDMinor'], '-9007199254740993')
            self.assertEqual(actual['lastConsumptionUSD'], '-90071992547409.93')
            self.assertEqual(actual['maskedCardNumber'], '**** 0012')
            self.assertEqual(actual['lastConsumptionAtUTC'], '2026-08-15T00:00:00Z')
        self.assertEqual(c.csv_safe(' @formula'), "' @formula")

    def test_reference_schema_confirms_sort_and_no_sensitive_request(self):
        ref = json.loads((s.ROOT / 'scripts/slash_schema_reference.json').read_text())
        params = {p['name']: p for p in ref['paths']['/card']['get']['parameters']}
        self.assertIn('createdAt', params['sort']['schema']['enum'])
        self.assertIn('DESC', params['sortDirection']['schema']['enum'])


if __name__ == '__main__':
    unittest.main()
