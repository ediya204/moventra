import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { cryptoError, cryptoRequest } from '../auth/cryptoApi';
import { cryptoMoney, cryptoUnits, type CryptoQuote } from '../auth/cryptoContract';

type Currency = 'USD' | 'USDT';
type Attempt = { key: string; status: 'loading' | 'ready' | 'error'; quote?: CryptoQuote; error?: string };

export default function OtcExchange({ customerId, enabled, blocked, busy, policyRevision, available, onTrade, CurrencyIcon }: {
  customerId: string;
  enabled: boolean;
  blocked: boolean;
  busy: boolean;
  policyRevision: number;
  available: Record<Currency, string | null>;
  onTrade: (quote: CryptoQuote) => void;
  CurrencyIcon: ComponentType<{ currency: string }>;
}) {
  const [currency, setCurrency] = useState<Currency>('USDT');
  const [amount, setAmount] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const submitted = useRef<string | null>(null);
  const buy: Currency = currency === 'USDT' ? 'USD' : 'USDT';
  let minor = '', validation = '';
  if (amount) {
    try { minor = cryptoUnits(amount, currency); }
    catch { if (!/^(0|[1-9][0-9]*)\.$/.test(amount)) validation = `请输入大于 0 的金额，最多 ${currency === 'USDT' ? 6 : 2} 位小数`; }
  }
  const key = `${customerId}:${currency}:${minor}:${policyRevision}`;
  const current = attempt?.key === key ? attempt : null;
  const quote = current?.quote;
  const fresh = !!quote && Date.parse(quote.expiresAt) > now;
  const total = quote ? BigInt(quote.amountMinor) + BigInt(quote.feeMinor) : null;
  const balance = available[currency];
  const enough = balance !== null && total !== null && BigInt(balance) >= total;
  const ready = enabled && !blocked && fresh && enough && submitted.current !== quote?.id;

  // Quotes are ephemeral; they neither reserve funds nor create orders. Keep
  // their lifecycle separate from the parent's persisted order/idempotency key.
  useEffect(() => {
    if (blocked) return;
    if (!enabled || !minor) { setAttempt(null); return; }
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setAttempt({ key, status: 'loading' });
    const debounce = setTimeout(() => {
      if (document.hidden) return;
      timeout = setTimeout(() => {
        if (active) { active = false; setAttempt({ key, status: 'error', error: '报价请求超时，请重试。' }); }
      }, 12000);
      void cryptoRequest<CryptoQuote>(`/client-api/v1/customers/${customerId}/crypto/otc/quotes`, { currency, amountMinor: minor }, crypto.randomUUID())
        .then(value => {
          if (!active) return;
          if (!value.id || value.kind !== 'otc' || value.customerId !== customerId || value.currency !== currency || value.toCurrency !== buy || value.amountMinor !== minor || value.policyRevision !== policyRevision || !/^[1-9][0-9]*$/.test(value.receiveMinor) || !/^(0|[1-9][0-9]*)$/.test(value.feeMinor) || !/^[0-9]+(?:\.[0-9]+)?$/.test(value.rate) || !(Date.parse(value.expiresAt) > Date.now())) {
            throw new Error('报价已变化或暂不可用，请刷新后重试。');
          }
          setNow(Date.now());
          setAttempt({ key, status: 'ready', quote: value });
        })
        .catch(error => { if (active) setAttempt({ key, status: 'error', error: cryptoError(error) }); })
        .finally(() => clearTimeout(timeout));
    }, 400);
    return () => { active = false; clearTimeout(debounce); clearTimeout(timeout); };
  }, [customerId, currency, buy, minor, key, enabled, blocked, policyRevision, retry]);

  useEffect(() => {
    if (!quote || blocked) return;
    const expiry = setTimeout(() => { setNow(Date.now()); setRetry(n => n + 1); }, Math.max(0, Date.parse(quote.expiresAt) - Date.now()) + 10);
    return () => clearTimeout(expiry);
  }, [quote, blocked]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (!document.hidden) { setNow(Date.now()); setRetry(n => n + 1); } };
    document.addEventListener?.('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener?.('visibilitychange', visible); };
  }, []);

  function trade() {
    // Recheck the wall clock at the click, including time between render ticks.
    if (!ready || !quote || submitted.current === quote.id) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { setNow(Date.now()); setRetry(n => n + 1); return; }
    submitted.current = quote.id;
    onTrade(quote);
  }
  const quoting = enabled && !!minor && !blocked && (!current || current.status === 'loading' || current.status === 'ready' && !fresh);
  return <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 680, width: '100%' }}>
    <Stack spacing={2.5}>
      <Box><Typography variant="h6">OTC 兑换</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>输入卖出数量，自动计算买入数量。</Typography></Box>
      <Box sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="subtitle2">卖出</Typography><Stack direction="row" spacing={1} alignItems="center"><CurrencyIcon currency={currency}/><Typography variant="subtitle1">{currency}</Typography></Stack></Stack>
          <TextField fullWidth label="卖出金额" placeholder="0.00" value={amount} disabled={blocked} error={!!validation} autoComplete="off"
            inputProps={{ inputMode: 'decimal', 'aria-describedby': 'otc-amount-hint' }}
            FormHelperTextProps={{ id: 'otc-amount-hint' }}
            helperText={validation || `可用余额：${balance === null ? '暂不可确认' : cryptoMoney(balance, currency)}`}
            onChange={event => setAmount(event.target.value)} />
        </Stack>
      </Box>
      <Button variant="outlined" aria-label="切换兑换方向" disabled={blocked} onClick={() => { setCurrency(buy); setAmount(''); }} sx={{ alignSelf: 'center', minWidth: 44, minHeight: 44, borderRadius: '50%', p: 1 }}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 19V5m-4 4 4-4 4 4M16 5v14m-4-4 4 4 4-4"/></svg>
      </Button>
      <Box sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="subtitle2">买入</Typography><Stack direction="row" spacing={1} alignItems="center"><CurrencyIcon currency={buy}/><Typography variant="subtitle1">{buy}</Typography></Stack></Stack>
          <Box role="status" aria-live="polite" aria-label="买入数量" aria-busy={quoting}>
            <Typography variant="h4" sx={{ overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{fresh && quote ? cryptoMoney(quote.receiveMinor, buy) : '—'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{quoting ? '正在更新报价…' : fresh ? '按当前报价可买入' : current?.status === 'error' ? '报价暂不可用' : '输入卖出金额后自动显示'}</Typography>
          </Box>
        </Stack>
      </Box>
      {current?.status === 'error' && <Alert severity="error" action={<Button disabled={blocked} onClick={() => setRetry(n => n + 1)}>重试报价</Button>}>{current.error}</Alert>}
      {fresh && quote && <Stack spacing={1} sx={{ px: .5 }}>
        <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2" color="text.secondary">汇率</Typography><Typography variant="body2">1 {currency} = {quote.rate} {buy}</Typography></Stack>
        <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2" color="text.secondary">手续费</Typography><Typography variant="body2">{cryptoMoney(quote.feeMinor, currency)}</Typography></Stack>
        <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2" color="text.secondary">合计扣款</Typography><Typography variant="subtitle2">{cryptoMoney(total!.toString(), currency)}</Typography></Stack>
        <Typography variant="caption" color="text.secondary">报价 {Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000))} 秒内有效，过期自动更新。</Typography>
      </Stack>}
      {fresh && !enough && <Alert severity="warning">{balance === null ? '钱包余额暂不可确认，请刷新后再成交。' : '可用余额不足以支付卖出金额及手续费，请调整金额。'}</Alert>}
      <Button variant="contained" fullWidth size="large" disabled={!ready} onClick={trade}>{busy ? '成交提交中…' : '成交'}</Button>
      <Typography variant="caption" color="text.secondary" textAlign="center">点击成交将按当前报价提交兑换，处理结果以订单状态为准。</Typography>
    </Stack>
  </Paper>;
}
