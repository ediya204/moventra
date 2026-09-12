#!/usr/bin/env python3
"""Bounded, GET-only Slash import and private loopback snapshot viewer. Python 3.9+."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import html
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
from urllib import error, parse, request
import uuid

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.slash-preview'
BASE = 'https://api.slash.com'
AGENT = 'ADSFLOW-Readonly-Preview/0.1'
MAPPING = 'slash-local-preview-v1'
DETAILS = {'pending', 'pending_approval', 'in_review', 'canceled', 'failed', 'settled',
           'declined', 'refund', 'reversed', 'returned', 'dispute'}


class PreviewError(Exception):
    pass


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def millis(value):
    if not isinstance(value, str):
        raise ValueError('missing date')
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('date needs timezone')
    return int(dt.timestamp() * 1000)


def config(path):
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise PreviewError('Credential file must be a regular private file (chmod 600).')
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\'')
    key = values.get('SLASH_API_KEY', '')
    entity = values.get('SLASH_LEGAL_ENTITY_ID', '')
    if not key or any(c in key + entity for c in '\r\n'):
        raise PreviewError('Missing or invalid local API credential.')
    return key, entity


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Slash:
    def __init__(self, key, entity=''):
        self.headers = {'X-API-Key': key, 'Accept': 'application/json', 'User-Agent': AGENT}
        if entity:
            self.headers['x-legal-entity'] = entity
        self.audit = []
        self.opener = request.build_opener(NoRedirect)

    def get(self, path, params=None):
        # No generic URL, method or body argument: callers cannot trigger deferred writes.
        allowed = {'/account': {'cursor'}, '/card-product': {'cursor'}, '/transaction': {
            'cursor', 'filter:accountId', 'filter:from_date', 'filter:to_date',
            'filter:category', 'filter:status', 'filter:detailed_status'},
            '/card': {'cursor', 'filter:accountId', 'sort', 'sortDirection'}}
        balance = re.fullmatch(r'/account/[A-Za-z0-9_-]+/balance', path)
        card = re.fullmatch(r'/card/[A-Za-z0-9_-]+', path)
        transaction = re.fullmatch(r'/transaction/[A-Za-z0-9_-]+', path)
        if transaction:
            allowed[path] = set()
        if card:
            if params != {'include_pan': 'false', 'include_cvv': 'false'}:
                raise PreviewError('Card details must explicitly exclude PAN and CVV.')
            allowed[path] = {'include_pan', 'include_cvv'}
        if path not in allowed and not balance:
            raise PreviewError('Upstream path is not allowed.')
        if set(params or {}) - allowed.get(path, set()):
            raise PreviewError('Upstream query is not allowed.')
        url = BASE + path + ('?' + parse.urlencode(params) if params else '')
        for attempt in range(3):
            req = request.Request(url, headers=self.headers, method='GET')
            try:
                response = self.opener.open(req, timeout=25)
            except error.HTTPError as exc:
                response = exc
            except (error.URLError, TimeoutError, OSError):
                raise PreviewError('Slash network request failed; no raw response logged.') from None
            with response:
                self.audit.append({'method': 'GET', 'resource': 'balance' if balance else 'card-detail' if card else 'transaction-detail' if transaction else path[1:],
                                   'status': response.code, 'requestId': response.headers.get('x-request-id'),
                                   'observedAt': now()})
                if response.code in (429, 502, 503, 504) and attempt < 2:
                    time.sleep(1 + attempt)
                    continue
                if response.code != 200:
                    raise PreviewError('Slash HTTP %s; response body withheld.' % response.code)
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise PreviewError('Slash response exceeds local size limit.')
                try:
                    return json.loads(raw, parse_float=Decimal,
                                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                except (ValueError, UnicodeError):
                    raise PreviewError('Invalid Slash JSON response.') from None


def text(value):
    return value if isinstance(value, str) else None


def minor(value):
    # JSON is decoded losslessly before normalization, including > JS safe integer values.
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)):
        return None
    if isinstance(value, Decimal) and (not value.is_finite() or value != value.to_integral_value()):
        return None
    if abs(value) > 10 ** 30:
        return None
    return str(int(value))


def status_review(row):
    return row.get('status') == 'posted' and row.get('detailedStatus') in {
        'reversed', 'pending', 'pending_approval', 'failed', 'declined', 'canceled'}


def merchant_projection(source, issues, path='merchantData'):
    """Keep only source strings/nulls, preserving absence and empty strings."""
    if source is None:
        return None
    if not isinstance(source, dict):
        issues.append(f'{path} 类型无效，未采集该字段')
        return None
    result = {}
    fields = ('description', 'categoryCode') if path == 'merchantData' else ('city', 'state', 'zip', 'country')
    for key in fields:
        if key not in source:
            continue
        value = source[key]
        if value is None or isinstance(value, str):
            result[key] = value
        else:
            issues.append(f'{path}.{key} 类型无效，未采集该字段')
    if path == 'merchantData' and 'location' in source:
        result['location'] = merchant_projection(source['location'], issues, path + '.location')
    return result


def project(source, account, start, end):
    if not isinstance(source, dict) or not text(source.get('id')):
        raise PreviewError('Source transaction has no valid identifier.')
    if source.get('accountId') != account:
        raise PreviewError('Source transaction is outside the selected account; snapshot not published.')
    issues = []
    row = {k: text(source.get(k)) for k in [
        'id', 'accountId', 'cardId', 'virtualAccountId', 'status', 'detailedStatus',
        'accountSubtype', 'date', 'authorizedAt', 'orderId', 'referenceNumber']}
    row['amountCents'] = minor(source.get('amountCents'))
    if row['amountCents'] is None:
        issues.append('金额缺失或不是有效整数分，未计入汇总')
    try:
        in_window = start <= millis(row['date']) < end
    except (ValueError, TypeError, OverflowError):
        in_window = False
        issues.append('来源日期缺失或无效，未计入区间汇总')
    row['inWindow'] = in_window
    if not in_window and not issues:
        issues.append('来源日期在请求区间外，未计入汇总')
    if row['status'] not in {'pending', 'posted', 'failed'} or row['detailedStatus'] not in DETAILS:
        issues.append('未知来源状态，保留原值')
    if status_review(row):
        issues.append('来源状态组合待渠道核实，未据此确认消费或结算结果')
    row['postedAt'] = row['date'] if row['status'] == 'posted' else None
    merchant = source.get('merchantData')
    if 'merchantData' in source:
        row['merchantData'] = merchant_projection(merchant, issues)
    row['merchant'] = text(merchant.get('description')) if isinstance(merchant, dict) else None
    row['categoryCode'] = text(merchant.get('categoryCode')) if isinstance(merchant, dict) else None
    original = source.get('originalCurrency')
    row['originalCurrency'] = None
    if isinstance(original, dict):
        rate = original.get('conversionRate')
        row['originalCurrency'] = {'code': text(original.get('code')),
            'amountCents': minor(original.get('amountCents')),
            'conversionRate': str(rate) if isinstance(rate, (int, Decimal)) and not isinstance(rate, bool) else None}
    # Preserve only financial annotations, never count them as additional ledger movements.
    for field in ['fxFeeInfo', 'cashbackInfo']:
        item = source.get(field)
        row[field] = {'amountCents': minor(item.get('amountCents'))} if isinstance(item, dict) else None
    row['issues'] = issues
    return row


def balances(payload):
    # GET /account/{id}/balance returns {balances: Balance[]}; unknown shapes are not zero.
    items = payload.get('balances') if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise PreviewError('Unexpected balance response shape.')
    result = []
    for item in items:
        if not isinstance(item, dict):
            raise PreviewError('Invalid balance object.')
        result.append({'type': text(item.get('type')), 'timestamp': text(item.get('timestamp')),
            'availableCents': minor(item.get('available', {}).get('amountCents')) if isinstance(item.get('available'), dict) else None,
            'postedCents': minor(item.get('posted', {}).get('amountCents')) if isinstance(item.get('posted'), dict) else None,
            'currency': None, 'currencyState': 'unverified'})
    return result


def collect(client, account, start, end, max_pages=50, filters=None):
    rows, observations, seen_cursors = {}, [], set()
    cursor, duplicates, changes = None, 0, 0
    exhausted = False
    for page in range(max_pages):
        params = {'filter:accountId': account, 'filter:from_date': str(start),
                  'filter:to_date': str(end - 1)}
        if filters:
            if set(filters) - {'filter:category', 'filter:status', 'filter:detailed_status'}:
                raise PreviewError('Invalid collection filters.')
            params.update(filters)
        if cursor:
            params['cursor'] = cursor
        payload = client.get('/transaction', params)
        if not isinstance(payload, dict) or not isinstance(payload.get('items'), list):
            raise PreviewError('Unexpected transaction response shape.')
        if len(observations) + len(payload['items']) > 10000:
            raise PreviewError('Local import limit exceeded (10000 observations).')
        for source in payload['items']:
            row = project(source, account, start, end)
            if row['id'] in rows:
                duplicates += 1
                changes += rows[row['id']] != row
            rows[row['id']] = row
            observations.append({'sequence': len(observations) + 1, 'collectedAt': now(), 'row': row})
        meta = payload.get('metadata')
        if not isinstance(meta, dict):
            raise PreviewError('Pagination metadata missing; cannot verify traversal.')
        # Public PaginationResponse: omitted nextCursor means there is no more data.
        cursor = meta.get('nextCursor')
        if cursor is None or cursor == '':
            exhausted = True
            break
        if not isinstance(cursor, str) or cursor in seen_cursors:
            raise PreviewError('Invalid or repeated pagination cursor.')
        seen_cursors.add(cursor)
    return list(rows.values()), observations, {'pages': page + 1, 'cursorExhausted': exhausted,
        'duplicates': duplicates, 'changedDuringFetch': changes, 'sourceSnapshotGuaranteed': False,
        'complete': False, 'reason': 'cursor_exhausted_not_snapshot_proof' if exhausted else 'page_limit'}


def summary(rows):
    counts = Counter()
    totals = {'postedIn': 0, 'postedOut': 0, 'postedNet': 0, 'pendingNet': 0}
    for row in rows:
        counts['total'] += 1
        counts['issues'] += bool(row['issues'])
        counts['statusReview'] += status_review(row)
        if not row['inWindow']:
            counts['outsideWindow'] += 1
            continue
        counts[row['status'] or 'unknown'] += 1
        if row['amountCents'] is None:
            continue
        amount = int(row['amountCents'])
        if row['status'] == 'posted':
            totals['postedNet'] += amount
            totals['postedIn' if amount >= 0 else 'postedOut'] += abs(amount)
        elif row['status'] == 'pending':
            totals['pendingNet'] += amount
    return {'counts': dict(counts), 'amountsUSDMinor': {k: str(v) for k, v in totals.items()}}


def open_store(folder):
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    conn = sqlite3.connect(folder / 'preview.sqlite')
    os.chmod(folder / 'preview.sqlite', 0o600)
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, state TEXT NOT NULL, meta TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(run_id TEXT NOT NULL, connection_id TEXT NOT NULL,
        resource_type TEXT NOT NULL, external_id TEXT NOT NULL, date TEXT, status TEXT, data TEXT NOT NULL,
        PRIMARY KEY(run_id, connection_id, resource_type, external_id));
      CREATE INDEX IF NOT EXISTS records_page ON records(run_id, date DESC, external_id);
      CREATE TABLE IF NOT EXISTS observations(run_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence));
    ''')
    return conn


def save_run(db, meta, rows, observations):
    run_id = str(uuid.uuid4())
    meta = dict(meta, runId=run_id, summary=summary(rows))
    with db:
        db.execute('INSERT INTO runs VALUES(?,?,?)', (run_id, 'ready', dump(meta)))
        db.executemany('INSERT INTO records VALUES(?,?,?,?,?,?,?)', [
            (run_id, meta['connectionId'], 'transaction', r['id'], r['date'], r['status'], dump(r)) for r in rows])
        db.executemany('INSERT INTO observations VALUES(?,?,?)', [
            (run_id, o['sequence'], dump(o)) for o in observations])
    return meta


def import_snapshot(args):
    key, entity = config(ROOT / '.env.slash.local')
    client = Slash(key, entity)
    db = open_store(DATA)
    try:
        accounts = client.get('/account')
        items = accounts.get('items') if isinstance(accounts, dict) else None
        if not isinstance(items, list) or accounts.get('metadata', {}).get('nextCursor'):
            raise PreviewError('Account discovery requires explicit scope; no data imported.')
        candidates = [a for a in items if not args.account or a.get('id') == args.account]
        if len(candidates) != 1:
            raise PreviewError('Select exactly one accessible account with --account; no data imported.')
        account = candidates[0]
        account_id = account.get('id')
        if not isinstance(account_id, str) or not re.fullmatch('[A-Za-z0-9_-]+', account_id):
            raise PreviewError('Invalid source account identifier.')
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=args.days)
        start, end = int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)
        scope = dump(['slash-local-preview', entity or 'entity-scoped-key', account_id])
        meta = {'dataMode': 'real_readonly_snapshot', 'mappingVersion': MAPPING,
            'connectionId': 'slash-local-' + hashlib.sha256(scope.encode()).hexdigest()[:24],
            'account': {k: text(account.get(k)) for k in ['id', 'name', 'type', 'status']},
            'from': start_dt.isoformat(timespec='milliseconds'), 'to': end_dt.isoformat(timespec='milliseconds'),
            'timeBasis': 'source_date', 'timezone': 'UTC', 'startedAt': now(),
            'customerMapping': 'not_configured', 'reconciliation': 'insufficient_data',
            'sourceAsOf': None, 'officialDocsChecked': '2026-09-07'}
        try:
            meta['balances'] = balances(client.get('/account/' + account_id + '/balance'))
            meta['balanceState'] = 'fetched_currency_unverified'
        except PreviewError as exc:
            meta['balances'], meta['balanceState'] = [], 'unavailable'
            meta['balanceError'] = str(exc)
        rows, observations, coverage = collect(client, account_id, start, end, args.max_pages)
        meta.update(coverage=coverage, completedAt=now(), audit=client.audit)
        saved = save_run(db, meta, rows, observations)
        print(dump({'runId': saved['runId'], 'account': meta['account']['name'],
            'summary': saved['summary'], 'coverage': coverage, 'balanceState': meta['balanceState'],
            'balanceTypes': [b['type'] for b in meta['balances']], 'requests': len(client.audit)}))
    except PreviewError as exc:
        with db:
            db.execute('INSERT INTO runs VALUES(?,?,?)', (str(uuid.uuid4()), 'failed',
                dump({'attemptedAt': now(), 'error': str(exc), 'audit': client.audit})))
        raise
    finally:
        db.close()


def esc(value):
    return html.escape(str(value)) if value is not None else '未知'


def money(value):
    if value is None:
        return '未知'
    number = int(value)
    return ('−' if number < 0 else '') + format(abs(number) // 100, ',') + '.' + str(abs(number) % 100).zfill(2)


CSS = '''
*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#18232d;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1440px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:center;gap:20px}h1{font-size:28px;margin:6px 0}h2{font-size:18px}p{margin:6px 0}.muted,small{color:#617080}small{display:block}a{color:#087c66;text-decoration:none}
.badge{background:#e5f5ef;color:#096b54;border-radius:6px;padding:6px 12px}.notice{background:#fff7df;border:1px solid #ecd9a5;border-radius:8px;padding:14px 18px;margin:22px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card,.panel{background:white;border:1px solid #dfe5eb;border-radius:10px;padding:20px}.value{font-size:27px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:10px}.panel{margin:24px 0;overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}th{text-align:left;color:#617080;font-size:12px;font-weight:500}td,th{padding:14px 12px;border-bottom:1px solid #edf0f3;vertical-align:top}td.amount{text-align:right;font-variant-numeric:tabular-nums}td.wrap{white-space:normal;min-width:200px;max-width:340px}nav{display:flex;gap:16px;align-items:center}input,select,button{padding:9px 12px;border:1px solid #d4dce5;border-radius:6px;background:white;color:inherit}button{cursor:pointer}form{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.detail{white-space:pre-wrap;word-break:break-word;font-size:12px}summary{cursor:pointer;color:#087c66}.warn{color:#a56312}footer{color:#617080;margin:25px 0}@media(max-width:800px){main{padding:16px}.grid{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start;flex-direction:column}.value{font-size:22px}}
'''


def page(db, params, route):
    if set(params) - {'page', 'q', 'status', 'run'} or any(len(v) != 1 for v in params.values()):
        raise PreviewError('Invalid query.')
    page_no = int(params.get('page', ['1'])[0])
    if not 1 <= page_no <= 10000:
        raise PreviewError('Invalid page.')
    latest = db.execute('SELECT state,meta FROM runs ORDER BY rowid DESC LIMIT 1').fetchone()
    run = params.get('run', [None])[0]
    record = db.execute('SELECT id,meta FROM runs WHERE state=? ' + ('AND id=? ' if run else '') +
        'ORDER BY rowid DESC LIMIT 1', ('ready', run) if run else ('ready',)).fetchone()
    if not record:
        raise PreviewError('No available imported snapshot.')
    run, encoded = record
    meta = json.loads(encoded)
    query = params.get('q', [''])[0]
    status = params.get('status', [''])[0]
    if len(query) > 100 or len(status) > 80:
        raise PreviewError('Filter too long.')
    where, bind = 'run_id=?', [run]
    if query:
        where += ' AND (instr(lower(json_extract(data,\'$.merchant\')),lower(?))>0 OR instr(external_id,?)>0 OR instr(json_extract(data,\'$.cardId\'),?)>0)'
        bind += [query] * 3
    if status:
        where += ' AND status=?'
        bind.append(status)
    count = db.execute('SELECT COUNT(*) FROM records WHERE ' + where, bind).fetchone()[0]
    records = db.execute('SELECT data FROM records WHERE ' + where +
        ' ORDER BY date DESC,external_id LIMIT 50 OFFSET ?', bind + [(page_no - 1) * 50]).fetchall()
    stats = meta['summary']
    # Derive review warnings for earlier immutable snapshots without rewriting source rows.
    status_pairs = db.execute("SELECT status,json_extract(data,'$.detailedStatus'),COUNT(*) FROM records WHERE run_id=? GROUP BY status,json_extract(data,'$.detailedStatus')", (run,)).fetchall()
    review_count = sum(n for st, detail, n in status_pairs if status_review({'status': st, 'detailedStatus': detail}))
    amounts = stats['amountsUSDMinor']
    account = meta['account']
    chunks = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Slash · 真实数据预览</title><style>' + CSS + '</style><main>',
        '<header><div><div class="muted">ADSFLOW / SLASH</div><h1>真实数据预览</h1><p>' +
        esc(account['name']) + ' · ' + esc(account['type']) + ' · 账户尾号 ' + esc(account['id'][-8:]) +
        '</p></div><span class="badge">只读导入 · 本地快照' +
        (' · 部分数据' if not meta['coverage']['cursorExhausted'] else '') + '</span></header>',
        '<div class="notice">这是已导入记录的查询视图。没有内部客户归属、期初余额或已确认对账结果；不能据此执行资金操作。' +
        ('<br><strong>当前是达到导入上限后的部分数据，不是最近 30 天全量。</strong>' if not meta['coverage']['cursorExhausted'] else '') +
        ('<br>' + str(review_count) + ' 条来源状态组合待核实（如 posted / reversed）；下方金额按来源 status 原值汇总，不代表已确认结算。' if review_count else '') +
        ('<br><strong>最近一次导入失败，当前展示旧快照。</strong>' if latest and latest[0] == 'failed' else '') +
        '</div><div class="grid">']
    for label, value, note in [
        ('导入交易', str(stats['counts'].get('total', 0)), '去重后记录 · 各状态分开展示'),
        ('来源 posted 流出 · USD', money(amounts['postedOut']), '仅当前快照内 posted 负数金额'),
        ('来源 posted 流入 · USD', money(amounts['postedIn']), '包括范围内退款及其他贷记'),
        ('来源 posted 净流量 · USD', money(amounts['postedNet']), '内部汇总 · 不等于账户余额')]:
        chunks.append('<div class="card"><span class="muted">' + label + '</span><div class="value">' + value + '</div><small>' + note + '</small></div>')
    chunks.append('</div><section class="panel"><h2>账户余额快照</h2><p class="muted">cash 与 credit 分别展示，不相加。来源未返回币种，本次币种尚未核实；保留原始 amountCents，不标为 USD。</p>')
    if meta['balanceState'] == 'unavailable':
        chunks.append('<p class="warn">余额获取失败：未知，不是零。</p>')
    else:
        chunks.append('<table><tr><th>余额类型</th><th>available.amountCents（来源原值）</th><th>posted.amountCents（来源原值）</th><th>来源计算时间</th></tr>')
        for b in meta['balances']:
            chunks.append('<tr>' + ''.join('<td>' + esc(b[k]) + '</td>' for k in ['type', 'availableCents', 'postedCents', 'timestamp']) + '</tr>')
        chunks.append('</table>')
    chunks.append('</section><section class="panel"><h2>交易明细</h2><p class="muted">金额为 Slash USD 记账金额。date：posted 时为入账时间，pending / failed 时为创建时间；时间均为 UTC。</p>')
    chunks.append('<form method="get"><input type="hidden" name="run" value="' + esc(run) + '"><input name="q" placeholder="搜索商户、交易或卡片 ID" value="' + esc(query) + '"><select name="status">')
    for value, label in [('', '所有来源状态'), ('posted', 'posted · 已入账'), ('pending', 'pending · 待入账'), ('failed', 'failed · 失败')]:
        chunks.append('<option value="' + value + '"' + (' selected' if status == value else '') + '>' + label + '</option>')
    chunks.append('</select><button>查询</button></form><p class="muted">当前筛选共 ' + str(count) + ' 条 · 每页 50 条 · 顶部汇总始终为整个导入快照</p><table><thead><tr><th>来源时间 / 交易 ID</th><th>商户 / 卡片</th><th>USD 记账金额</th><th>来源状态</th><th>来源详情</th></tr></thead><tbody>')
    for encoded, in records:
        r = json.loads(encoded)
        if status_review(r) and not any('状态组合' in i for i in r['issues']):
            r['issues'].append('来源状态组合待渠道核实，未据此确认消费或结算结果')
        chunks.append('<tr><td>' + esc(r['date']) + '<small>' + esc(r['id']) + '</small></td><td class="wrap">' + esc(r['merchant']) + '<small>卡片 ID 尾段 ' + esc(r['cardId'][-8:] if r['cardId'] else None) + '</small></td><td class="amount">' + money(r['amountCents']) + '</td><td>' + esc(r['status']) + '<small>' + esc(r['detailedStatus']) + '</small></td><td class="wrap"><details><summary>查看字段</summary><pre class="detail">' + esc(json.dumps(r, ensure_ascii=False, indent=2)) + '</pre></details>' + ''.join('<small class="warn">' + esc(i) + '</small>' for i in r['issues']) + '</td></tr>')
    if not records:
        chunks.append('<tr><td colspan="5">当前筛选没有记录。</td></tr>')
    chunks.append('</tbody></table><nav>')
    for target, label in [(page_no - 1, '上一页'), (page_no + 1, '下一页')]:
        if target >= 1 and (target - 1) * 50 < count:
            link = route + '?' + parse.urlencode({'run': run, 'q': query, 'status': status, 'page': target})
            chunks.append('<a href="' + esc(link) + '">' + label + '</a>')
    coverage = meta['coverage']
    chunks.append('<span>第 ' + str(page_no) + ' 页</span></nav></section><footer><p>导入范围 [from, to)：' + esc(meta['from']) + ' → ' + esc(meta['to']) + '</p><p>采集完成：' + esc(meta['completedAt']) + ' · 来源分页：' + str(coverage['pages']) + ' 页 · ' + ('已遍历游标' if coverage['cursorExhausted'] else '达到页数上限，仅部分数据') + '</p><p>重复观察：' + str(coverage['duplicates']) + ' · 抓取期间变化：' + str(coverage['changedDuringFetch']) + ' · 字段异常：' + str(stats['counts'].get('issues', 0)) + '</p><p>游标遍历不证明渠道历史完整或同一时点快照。未接入 Webhook；来源时间可能随后变化；刷新页面只读取本地数据。</p><p>快照 ' + esc(run) + ' · 映射 ' + MAPPING + '</p></footer></main></html>')
    return ''.join(chunks).encode('utf-8')


def serve(args):
    token = secrets.token_urlsafe(32)
    route = '/' + token + '/'
    host = '127.0.0.1:' + str(args.port)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log the private capability URL or financial filters.

        def do_GET(self):
            url = parse.urlsplit(self.path)
            if self.headers.get('Host') != host or url.path != route or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(404)
                return
            try:
                db = sqlite3.connect('file:' + str(DATA / 'preview.sqlite') + '?mode=ro', uri=True)
                try:
                    body = page(db, parse.parse_qs(url.query, keep_blank_values=True, max_num_fields=8), route)
                finally:
                    db.close()
            except (PreviewError, ValueError):
                self.send_error(400, 'Invalid preview query')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

    server = HTTPServer(('127.0.0.1', args.port), Handler)
    print('http://' + host + route, flush=True)
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    imp = sub.add_parser('import')
    imp.add_argument('--account')
    imp.add_argument('--days', type=int, default=30, choices=range(1, 31))
    imp.add_argument('--max-pages', type=int, default=50, choices=range(1, 101))
    view = sub.add_parser('serve')
    view.add_argument('--port', type=int, default=8872)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        import_snapshot(args) if args.command == 'import' else serve(args)
    except PreviewError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
    except (OSError, ValueError, sqlite3.Error):
        print('Local preview operation failed; sensitive details withheld.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
