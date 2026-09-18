import { useEffect, useState } from 'react';
import { Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../../../../packages/shared/src/auth/AuthContext';
import { PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { issuingRequest } from '../../../../packages/shared/src/issuing/api';
import { money, type Product } from '../../../../packages/shared/src/issuing/contract';
import { PriceEditor } from './BinCatalogPage';

type Detail = { product: Product; prices: Record<string, unknown>[] };
export default function PricingPage() {
  const { ready, authenticated, user, session } = useAuth();
  if (!ready) return <PageSkeleton />;
  if (!authenticated || !session?.operator || !session.mfaVerified)
    return <Navigate to={user ? '/session?security=1' : '/admin/login'} replace />;
  return <DashboardLayout production><PricingContent /></DashboardLayout>;
}

function PricingContent() {
  const { productId } = useParams();
  const [params, setParams] = useSearchParams();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Product[] | Detail>();
  const [error, setError] = useState('');
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 501 ? rawPage : 1;
  const q = params.get('q') || '';
  const validId = !productId || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(productId);
  const refresh = () => setReload(n => n + 1);
  useEffect(() => {
    let active = true;
    setData(undefined); setError('');
    if (!validId) { setError('产品 ID 无效，请返回费率列表。'); return; }
    const path = '/admin-api/v1/card-issuing/products' + (productId ? '/' + productId : '?' + new URLSearchParams({ page: String(page), q }));
    issuingRequest<Product[] | Detail>(path).then(value => {
      if (active) setData(value);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [productId, validId, page, q, reload]);
  const detail = data && !Array.isArray(data) ? data : undefined;
  return <Stack spacing={3}>
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="h4">费率管理</Typography>
      <Button onClick={refresh}>刷新</Button>
    </Stack>
    <Alert severity="info">当前管理 USD 卡产品开卡费：客户专属价优先于定价组价，最后使用产品默认价。数字货币提现和 OTC 成交价通过独立隔离资金配置维护。</Alert>
    <Stack direction="row" gap={1}>
      {productId && <Button component={Link} to={'/pricing' + (params.size ? '?' + params : '')}>返回费率列表</Button>}
      <Button component={Link} to="/finance/otc?tab=settings">提现手续费与 OTC 成交价</Button>
      <Button component={Link} to="/card-bins/groups">管理定价组</Button>
      <Button component={Link} to="/card-bins/audit">查看维护记录</Button>
    </Stack>
    {!productId && <TextField label="搜索产品名称 / BIN" value={q} onChange={e => {
      const next = new URLSearchParams(params); next.set('q', e.target.value); next.delete('page'); setParams(next);
    }} />}
    {error ? <Alert severity="error" action={<Button onClick={refresh}>重试</Button>}>{error}</Alert> : !data ? <PageSkeleton /> : detail ? <>
      <Paper variant="outlined" sx={{ p: 3 }}><Stack spacing={1}>
        <Typography variant="h6">{detail.product.name} · {detail.product.bin}</Typography>
        <Typography>默认开卡费：{detail.product.feeMinor === '' ? '未配置' : money(detail.product.feeMinor) + ' USD'}</Typography>
        <Typography>最低首充：{detail.product.minimumMinor === '' ? '未配置' : money(detail.product.minimumMinor) + ' USD'}</Typography>
        <Button component={Link} to={'/card-bins/' + detail.product.id}>维护产品默认价格</Button>
      </Stack></Paper>
      <PriceEditor key={detail.product.id + ':' + detail.product.revision} id={detail.product.id} revision={detail.product.revision} prices={detail.prices} saved={refresh} />
    </> : Array.isArray(data) && <>
      {!data.length ? <Alert severity="info">当前条件下没有卡产品。</Alert> : <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table aria-label="产品费率列表">
        <TableHead><TableRow>{['产品 / BIN', '默认开卡费 · USD', '最低首充 · USD', '操作'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{data.slice(0, 50).map(product => <TableRow key={product.id}>
          <TableCell>{product.name} · {product.bin}</TableCell>
          <TableCell>{product.feeMinor === '' ? '未配置' : money(product.feeMinor)}</TableCell>
          <TableCell>{product.minimumMinor === '' ? '未配置' : money(product.minimumMinor)}</TableCell>
          <TableCell><Button component={Link} to={'/pricing/products/' + product.id + (params.size ? '?' + params : '')}>管理费率</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table></Paper>}
      <Stack direction="row" gap={2}>{[-1, 1].map(step => <Button key={step} disabled={step < 0 ? page === 1 : data.length <= 50 || page >= 501} onClick={() => {
        const next = new URLSearchParams(params); next.set('page', String(page + step)); setParams(next);
      }}>{step < 0 ? '上一页' : '下一页'}</Button>)}<Typography>第 {page} 页 · 每页 50 条</Typography></Stack>
    </>}
  </Stack>;
}
