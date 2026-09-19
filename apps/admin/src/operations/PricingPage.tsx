import FinanceWorkspace from './FinanceWorkspace';
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
  return <DashboardLayout production><FinanceWorkspace className="finance-pricing"><PricingContent /></FinanceWorkspace></DashboardLayout>;
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
  return <Stack spacing={2.5}>
    <div className="finance-header"><div><span className="finance-kicker">资金与财务 / 费率</span>{productId&&<Button component={Link} to={'/pricing'+(params.size?'?'+params:'')} sx={{p:0,mb:1}}>返回费率列表</Button>}<Typography variant="h4">{productId?'产品费率配置':'费率管理'}</Typography><p>USD 卡产品开卡费 · 客户专属价优先，其次定价组价，最后使用产品默认价</p></div><Button variant="outlined" onClick={refresh}>刷新</Button></div>
    <div className="finance-subnav"><Button component={Link} to="/finance/otc?tab=settings">提现手续费与 OTC 成交价 ↗</Button><Button component={Link} to="/card-bins/groups">管理定价组 ↗</Button><Button component={Link} to="/card-bins/audit">维护记录 ↗</Button></div>
    {!productId&&<div className="finance-toolbar"><TextField size="small" className="finance-search" label="搜索产品名称 / BIN" value={q} onChange={e=>{const next=new URLSearchParams(params);next.set('q',e.target.value);next.delete('page');setParams(next)}}/><Typography variant="caption" color="text.secondary">开卡费与首充分别列示 · USD</Typography></div>}
    {error ? <Alert severity="error" action={<Button onClick={refresh}>重试</Button>}>{error}</Alert> : !data ? <PageSkeleton /> : detail ? <>
      <div className="finance-pricing-detail"><Paper variant="outlined" className="finance-product-summary"><Stack spacing={2.5}>
        <div><Typography variant="caption" color="text.secondary">当前产品</Typography><Typography variant="h6" sx={{mt:.5}}>{detail.product.name}</Typography><Typography variant="body2" color="text.secondary">BIN · {detail.product.bin}</Typography></div>
        <dl className="finance-facts"><div><dt>默认开卡费</dt><dd className="finance-money">{detail.product.feeMinor===''?'未配置':money(detail.product.feeMinor)+' USD'}</dd></div><div><dt>最低首充</dt><dd>{detail.product.minimumMinor===''?'未配置':money(detail.product.minimumMinor)+' USD'}</dd></div></dl>
        <Button variant="outlined" component={Link} to={'/card-bins/'+detail.product.id}>维护产品默认价格 ↗</Button>
      </Stack></Paper>
      <PriceEditor key={detail.product.id+':'+detail.product.revision} id={detail.product.id} revision={detail.product.revision} prices={detail.prices} saved={refresh}/></div>
    </> : Array.isArray(data) && <>
      {!data.length ? <Alert severity="info">当前条件下没有卡产品。</Alert> : <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table aria-label="产品费率列表">
        <TableHead><TableRow>{['产品 / BIN', '默认开卡费 · USD', '最低首充 · USD', '操作'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{data.slice(0, 50).map(product => <TableRow key={product.id}>
          <TableCell><Typography variant="body2" fontWeight={600}>{product.name}</Typography><Typography variant="caption" color="text.secondary">BIN · {product.bin}</Typography></TableCell>
          <TableCell>{product.feeMinor === '' ? '未配置' : money(product.feeMinor)}</TableCell>
          <TableCell>{product.minimumMinor === '' ? '未配置' : money(product.minimumMinor)}</TableCell>
          <TableCell><Button component={Link} to={'/pricing/products/' + product.id + (params.size ? '?' + params : '')}>管理费率</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table></Paper>}
      <Stack className="finance-pagination" direction="row" gap={2}>{[-1, 1].map(step => <Button key={step} disabled={step < 0 ? page === 1 : data.length <= 50 || page >= 501} onClick={() => {
        const next = new URLSearchParams(params); next.set('page', String(page + step)); setParams(next);
      }}>{step < 0 ? '上一页' : '下一页'}</Button>)}<Typography>第 {page} 页 · 每页 50 条</Typography></Stack>
    </>}
  </Stack>;
}
