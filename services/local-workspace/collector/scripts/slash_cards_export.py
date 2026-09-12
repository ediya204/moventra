#!/usr/bin/env python3
"""Export latest-created and latest-consumed cards, 20 per group by default, read-only."""
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid

import slash_preview as s

CARD_FIELDS = ['id', 'accountId', 'name', 'status', 'createdAt', 'cardGroupId',
               'cardGroupName', 'cardProductId', 'virtualAccountId']
HEADERS = ['rank', 'provider', 'connectionId', 'cardId', 'accountId', 'cardName',
           'maskedCardNumber', 'cardStatus', 'createdAtUTC', 'isPhysical', 'isSingleUse',
           'cardGroupId', 'cardGroupName', 'cardProductId', 'virtualAccountId',
           'lastConsumptionAtUTC', 'lastConsumptionUSDMinor', 'lastConsumptionUSD',
           'lastConsumptionTransactionId', 'lastConsumptionMerchant', 'cardFetchState', 'collectedAtUTC']


def card_projection(source, account, expected_id=None):
    if not isinstance(source, dict) or not isinstance(source.get('id'), str):
        raise s.PreviewError('Invalid card response.')
    if source.get('accountId') != account or (expected_id and source['id'] != expected_id):
        raise s.PreviewError('Card is outside selected account or does not match requested ID.')
    row = {k: s.text(source.get(k)) for k in CARD_FIELDS}
    last4 = s.text(source.get('last4'))
    row['maskedCardNumber'] = '**** ' + last4 if last4 and re.fullmatch(r'[0-9]{4}', last4) else None
    for flag in ['isPhysical', 'isSingleUse']:
        row[flag] = source.get(flag) if isinstance(source.get(flag), bool) else None
    row['collectedAt'] = s.now()
    return row


def latest_created(client, account, count=100, cache=None):
    result, cursors, cursor = {}, set(), None
    last_time, inversions = None, 0
    for page in range(500):
        params = {'filter:accountId': account, 'sort': 'createdAt', 'sortDirection': 'DESC'}
        if cursor:
            params['cursor'] = cursor
        data = client.get('/card', params)
        if not isinstance(data, dict) or not isinstance(data.get('items'), list) or not isinstance(data.get('metadata'), dict):
            raise s.PreviewError('Invalid card list or missing pagination metadata.')
        for source in data['items']:
            row = card_projection(source, account)
            try:
                created = s.millis(row['createdAt'])
            except (ValueError, TypeError):
                raise s.PreviewError('Card creation date is unavailable; latest ordering cannot be verified.') from None
            if last_time is not None and created > last_time:
                inversions += 1
            last_time = created
            result[row['id']] = row
        exhausted = not data['metadata'].get('nextCursor')
        if exhausted or (len(result) >= count and inversions == 0):
            if cache is not None:
                cache.update(result)
            return sorted(result.values(), key=lambda r: (s.millis(r['createdAt']), r['id']), reverse=True)[:count], {
                'pages': page + 1, 'sort': 'createdAt DESC', 'count': min(count, len(result)),
                'scannedCards': len(result), 'observedSortInversions': inversions,
                'inventoryCursorExhausted': exhausted, 'sourceSnapshotGuaranteed': False}
        cursor = data['metadata']['nextCursor']
        if not isinstance(cursor, str) or cursor in cursors:
            raise s.PreviewError('Invalid card pagination cursor.')
        cursors.add(cursor)
        if (page + 1) % 25 == 0:
            print(s.dump({'cardInventoryPages': page + 1, 'uniqueCardsScanned': len(result),
                          'reason': 'verify_latest_after_source_sort_inversion'}), flush=True)
    raise s.PreviewError('Card page limit reached before latest ordering could be established.')


def most_recent_consumption(rows):
    latest = {}
    for row in rows:
        card = row.get('cardId')
        # Internal selection definition: posted + settled + negative card transaction.
        # Refunds, reversed authorizations, pending and declined events are excluded.
        if not card or row.get('status') != 'posted' or row.get('detailedStatus') != 'settled' or not row.get('inWindow'):
            continue
        amount = row.get('amountCents')
        if amount is None or int(amount) >= 0:
            continue
        if card not in latest or (s.millis(row['date']), row['id']) > (s.millis(latest[card]['date']), latest[card]['id']):
            latest[card] = row
    return sorted(latest.values(), key=lambda r: (s.millis(r['date']), r['cardId']), reverse=True)


def csv_safe(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    value = str(value)
    if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')):
        return "'" + value
    return value


def csv_row(card, rank, connection, transaction=None):
    t = transaction or {}
    amount = t.get('amountCents')
    return {'rank': rank, 'provider': 'slash', 'connectionId': connection,
        'cardId': card['id'], 'accountId': card['accountId'], 'cardName': card.get('name'),
        'maskedCardNumber': card.get('maskedCardNumber'), 'cardStatus': card.get('status'),
        'createdAtUTC': card.get('createdAt'), 'isPhysical': card.get('isPhysical'),
        'isSingleUse': card.get('isSingleUse'), 'cardGroupId': card.get('cardGroupId'),
        'cardGroupName': card.get('cardGroupName'), 'cardProductId': card.get('cardProductId'),
        'virtualAccountId': card.get('virtualAccountId'), 'lastConsumptionAtUTC': t.get('date'),
        'lastConsumptionUSDMinor': amount,
        'lastConsumptionUSD': s.money(amount).replace('−', '-') if amount is not None else None,
        'lastConsumptionTransactionId': t.get('id'), 'lastConsumptionMerchant': t.get('merchant'),
        'cardFetchState': card.get('fetchState', 'fetched'), 'collectedAtUTC': card.get('collectedAt')}


def write_csv(path, rows):
    with path.open('x', encoding='utf-8-sig', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=HEADERS)
        writer.writeheader()
        for row in rows:
            safe = {key: csv_safe(value) for key, value in row.items()}
            # Only validated canonical numeric columns bypass spreadsheet formula escaping.
            for key in ['lastConsumptionUSDMinor', 'lastConsumptionUSD']:
                value = row.get(key)
                if value is not None and re.fullmatch(r'-?[0-9]+(?:\.[0-9]{2})?', str(value).replace(',', '')):
                    safe[key] = str(value).replace(',', '')
            writer.writerow(safe)


def export(count=20):
    key, entity = s.config(s.ROOT / '.env.slash.local')
    client = s.Slash(key, entity)
    with sqlite3.connect('file:' + str(s.DATA / 'preview.sqlite') + '?mode=ro', uri=True) as db:
        result = db.execute("SELECT id,meta FROM runs WHERE state='ready' ORDER BY rowid DESC LIMIT 1").fetchone()
        if not result:
            raise s.PreviewError('Import an account preview first.')
        run, meta = result[0], json.loads(result[1])
        candidates = most_recent_consumption([json.loads(r[0]) for r in db.execute('SELECT data FROM records WHERE run_id=?', (run,))])
    account = meta['account']['id']
    accessible = client.get('/account')
    if not any(a.get('id') == account for a in accessible.get('items', [])):
        raise s.PreviewError('Snapshot account is not accessible with current credentials.')
    cache = {}
    recent_cards, created_coverage = latest_created(client, account, count=count, cache=cache)
    print(s.dump({'latestCreatedFetched': len(recent_cards)}), flush=True)
    # The first import is partial. Use it only to choose a LOWER BOUND, then fully
    # traverse this newer interval. Older transactions cannot outrank this interval.
    start = s.millis(candidates[min(len(candidates), count + count // 2) - 1]['date']) if len(candidates) >= count else s.millis(meta['from'])
    end = int(datetime.now(timezone.utc).timestamp() * 1000)
    rows, observations, coverage = s.collect(client, account, start, end, max_pages=100,
        filters={'filter:category': 'card', 'filter:status': 'posted', 'filter:detailed_status': 'settled'})
    if not coverage['cursorExhausted']:
        raise s.PreviewError('Recent consumption window could not be fully traversed; exact ranking not exported.')
    consumers = most_recent_consumption(rows)[:count]
    if len(consumers) < count and start > s.millis(meta['from']):
        raise s.PreviewError('Source changes left too few cards in narrowed window; widen window before exporting.')
    selected = []
    for i, transaction in enumerate(consumers):
        card_id = transaction['cardId']
        if card_id not in cache:
            if not re.fullmatch('[A-Za-z0-9_-]+', card_id):
                raise s.PreviewError('Invalid source card identifier.')
            data = client.get('/card/' + card_id, {'include_pan': 'false', 'include_cvv': 'false'})
            cache[card_id] = card_projection(data, account, card_id)
        selected.append(csv_row(cache[card_id], i + 1, meta['connectionId'], transaction))
        if (i + 1) % 20 == 0:
            print(s.dump({'recentConsumptionCardsFetched': i + 1}), flush=True)
    output = s.DATA / 'exports' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    output.mkdir(mode=0o700, parents=True)
    latest_rows = [csv_row(c, i + 1, meta['connectionId']) for i, c in enumerate(recent_cards)]
    write_csv(output / ('cards-latest-created-%d.csv' % count), latest_rows)
    write_csv(output / ('cards-recent-consumption-%d.csv' % count), selected)
    latest_ids = {r['cardId'] for r in latest_rows}
    consumer_ids = {r['cardId'] for r in selected}
    evidence = {'dataMode': 'real_readonly_export', 'generatedAt': s.now(), 'requestedCountPerGroup': count, 'accountId': account,
        'connectionId': meta['connectionId'], 'sourcePreviewRun': run, 'latestCreated': created_coverage,
        'recentConsumptionCount': len(selected), 'overlapCount': len(latest_ids & consumer_ids),
        'unionCount': len(latest_ids | consumer_ids),
        'selectionRule': 'card category, posted, settled, negative USD amount; latest date per distinct card',
        'consumptionFromUTC': datetime.fromtimestamp(start / 1000, timezone.utc).isoformat(),
        'consumptionToUTC': datetime.fromtimestamp(end / 1000, timezone.utc).isoformat(),
        'consumptionCoverage': coverage, 'ranking': 'observed data; no cross-page snapshot guarantee',
        'requests': client.audit, 'sensitiveCardDetailsRequested': False}
    (output / 'export-evidence.json').write_text(s.dump(evidence) + '\n')
    (output / 'cards-sanitized.json').write_text(s.dump({'latestCreated': latest_rows, 'recentConsumption': selected}) + '\n')
    (output / 'consumption-observations.json').write_text(s.dump(observations) + '\n')
    print(s.dump({'output': str(output), 'latestCreatedCount': len(latest_rows),
        'recentConsumptionCount': len(selected), 'overlapCount': evidence['overlapCount'],
        'unionCount': evidence['unionCount'], 'transactionPages': coverage['pages'], 'requests': len(client.audit)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=20, choices=range(1, 101))
    args = parser.parse_args()
    os.umask(0o077)
    try:
        export(args.count)
    except s.PreviewError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
    except (OSError, ValueError, sqlite3.Error):
        print('Card export failed; sensitive exception details withheld.', file=sys.stderr)
        raise SystemExit(1)
