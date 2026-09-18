#!/usr/bin/env python3
"""Read-only bounded Slash projection export; stdout is private, sanitized JSON.
No SDK dependencies. Pipe the result to a private file, never to shared logs.
"""
import datetime
import decimal
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ID = re.compile(r'^[A-Za-z0-9_-]{1,160}$')


def money(value):
    if isinstance(value, bool) or not isinstance(value, (int, decimal.Decimal)):
        raise ValueError('invalid source amount')
    if value != int(value):
        raise ValueError('nonintegral source minor units')
    result = str(int(value))
    if len(result.lstrip('-')) > 38:
        raise ValueError('source amount too large')
    return result


def collect(get, connection, account, wallet, label, expected_cards):
    if not all(ID.fullmatch(x) for x in [connection, account, wallet, *expected_cards]):
        raise ValueError('invalid reviewed scope')
    if not expected_cards or len(set(expected_cards)) != len(expected_cards):
        raise ValueError('fixed nonempty unique roster required')
    fact = get('/virtual-account/' + wallet, {})['virtualAccount']
    if (fact['id'], fact['accountId'], fact['name'], fact['accountType']) != (wallet, account, label, 'default') or fact.get('closedAt'):
        raise ValueError('wallet facts do not match')

    def pages(path):
        query = {'filter:accountId': account, 'filter:virtualAccountId': wallet}
        seen_cursors = set()
        items = []
        for _ in range(20):
            page = get(path, query)
            if not isinstance(page.get('items'), list) or len(page['items']) > 1000:
                raise ValueError('invalid or oversized page')
            items.extend(page['items'])
            cursor = page['metadata'].get('nextCursor')
            if not cursor:
                return items
            if not isinstance(cursor, str) or cursor in seen_cursors or len(cursor) > 4096:
                raise ValueError('invalid pagination')
            seen_cursors.add(cursor)
            query['cursor'] = cursor
        raise ValueError('history bound reached; no partial export')

    cards = pages('/card')
    if len(cards) != len(expected_cards) or {c['id'] for c in cards} != set(expected_cards):
        raise ValueError('card roster changed; review required')
    records = []
    for c in cards:
        if c.get('accountId') != account or c.get('virtualAccountId') != wallet:
            raise ValueError('card outside wallet')
        data = {k: c[k] for k in ('id', 'accountId', 'virtualAccountId', 'name', 'last4') if k in c and c[k] is not None}
        if c.get('status') is not None:
            data['cardStatus'] = c['status']
        if c.get('createdAt') is not None:
            data['createdAtUTC'] = c['createdAt']
        records.append({'kind': 'card', 'data': data})
    transactions = pages('/transaction')
    seen = set()
    excluded = 0
    for t in transactions:
        if t.get('accountId') != account or t.get('virtualAccountId') != wallet or t.get('cardId') not in expected_cards:
            excluded += 1
            continue
        if t['id'] in seen:
            raise ValueError('duplicate transaction across pages; repeat read')
        seen.add(t['id'])
        data = {k: t[k] for k in ('id', 'accountId', 'virtualAccountId', 'cardId', 'status', 'detailedStatus', 'date', 'authorizedAt') if k in t and t[k] is not None}
        data['amountCents'] = money(t['amountCents'])
        md = t.get('merchantData')
        if isinstance(md, dict):
            data['merchantData'] = {k: md[k] for k in ('description', 'categoryCode') if isinstance(md.get(k), str)}
            if isinstance(md.get('location'), dict):
                data['merchantData']['location'] = {k: md['location'][k] for k in ('city', 'state', 'country', 'zip') if isinstance(md['location'].get(k), str)}
            if isinstance(md.get('description'), str):
                data['merchant'] = md['description']
        original = t.get('originalCurrency')
        if isinstance(original, dict):
            data['originalCurrency'] = {}
            if original.get('code') is not None:
                data['originalCurrency']['code'] = original['code']
            if original.get('amountCents') is not None:
                data['originalCurrency']['amountCents'] = money(original['amountCents'])
            if original.get('conversionRate') is not None:
                data['originalCurrency']['conversionRate'] = str(original['conversionRate'])
        records.append({'kind': 'transaction', 'data': data})
    return {'connectionId': connection, 'accountId': account, 'label': label,
            'sourceAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
            'records': records}, {'cards': len(cards), 'cardTransactions': len(seen), 'excludedRecords': excluded,
                                  'paginationExhausted': True, 'fullStatementVerified': False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect refused')


def main():
    manifest = json.load(sys.stdin)
    key = os.environ['SLASH_API_KEY']
    opener = urllib.request.build_opener(NoRedirect())

    def get(path, query):
        req = urllib.request.Request('https://api.slash.com' + path + ('?' + urllib.parse.urlencode(query) if query else ''), headers={'X-API-Key': key, 'Accept': 'application/json'})
        with opener.open(req, timeout=20) as response:
            raw = response.read((4 << 20) + 1)
            if len(raw) > 4 << 20:
                raise ValueError('source page too large')
        return json.loads(raw, parse_float=decimal.Decimal)

    bundle, coverage = collect(get, manifest['connectionId'], manifest['accountId'], manifest['virtualAccountId'], manifest['label'], manifest['cardIds'])
    json.dump({'bundle': bundle, 'coverage': coverage}, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Wallet collection refused; no partial export. Check credentials, reviewed roster and page coverage.', file=sys.stderr)
        sys.exit(1)
