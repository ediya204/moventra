import SectionNavigation from '../../../../packages/shared/src/components/SectionNavigation';
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Link,
  useLocation,
  useNavigate,
  Navigate,
  useSearchParams,
} from "react-router-dom";
import {
  issuingRequest as api,
  IssuingError,
} from "../../../../packages/shared/src/issuing/api";
import {
  money,
  toMinor,
  reasons,
  orderStatuses,
  type PublicProduct,
  type Quote,
  type Terms,
  type Wallet,
  type Order,
  type IssuedCard,
} from "../../../../packages/shared/src/issuing/contract";
import {
  LoadError,
  OrderSummary,
  orderPending,
  useIssuing,
} from "../../../../packages/shared/src/issuing/ui";
import {
  pendingKey,
  readPending,
  savePending,
  type PendingIssuing,
} from "../../../../packages/shared/src/issuing/pending";

const issuingIconPaths = {
  card: "M3 7h18M3 11h18M6 16h4M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  wallet: "M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7m17 6h-5v4h5m-3-2h.01",
  check: "m5 12 4 4L19 6",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5",
  receipt: "M8 8h8M8 12h5M5 3h14v18l-3-2-4 2-4-2-3 2V3Z",
  clock: "M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  arrow: "M4 12h16m-6-6 6 6-6 6",
};
function IssuingIcon({ name, size = 18 }: { name: keyof typeof issuingIconPaths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d={issuingIconPaths[name]} /></svg>;
}

function Pager({
  page,
  next,
  go,
}: {
  page: number;
  next: boolean;
  go: (n: number) => void;
}) {
  return (
    <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="space-between" alignItems="center">
      <Button disabled={page <= 1} onClick={() => go(page - 1)}>
        上一页
      </Button>
      <Typography>第 {page} 页</Typography>
      <Button disabled={!next} onClick={() => go(page + 1)}>
        下一页
      </Button>
    </Stack>
  );
}
function safePage(value: string | null) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2000 ? n : 1;
}
export default function CardIssuing({
  customerId,
  uid,
}: {
  customerId: string;
  uid: string;
}) {
  const base = `/client-api/v1/customers/${customerId}/card-issuing`;
  const { pathname } = useLocation();
  const id = pathname.split("/").at(-1)!;
  return (
    <Stack spacing={3}>
      {pathname !== "/portal/cards" && <SectionNavigation label="卡片分区" active={pathname.startsWith('/portal/card-orders')?'orders':pathname==='/portal/cards/new'?'new':'cards'} items={[
        {value:'cards',label:'我的卡片',to:'/portal/cards'},
        {value:'new',label:'申请新卡',to:'/portal/cards/new'},
        {value:'orders',label:'开卡订单',to:'/portal/card-orders'},
      ]}/>}
      {pathname === "/portal/cards/new" ? (
        <Checkout
          key={customerId}
          base={base}
          uid={uid}
          customerId={customerId}
        />
      ) : pathname.startsWith("/portal/card-orders/") ? (
        <OrderDetail
          key={id}
          base={base}
          id={id}
          uid={uid}
          customerId={customerId}
        />
      ) : pathname.startsWith("/portal/issued-cards/") ? (
        <CardDetail base={base} id={id} />
      ) : (
        <RecordList base={base} cards={pathname === "/portal/cards"} />
      )}
    </Stack>
  );
}
function Checkout({
  base,
  uid,
  customerId,
}: {
  base: string;
  uid: string;
  customerId: string;
}) {
  const [params, setParams] = useSearchParams();
  const page = safePage(params.get("page")),
    query = params.get("q") || "",
    selected = params.get("product") || "";
  const [search, setSearch] = useState(query);
  const products = useIssuing<PublicProduct[]>(
    `${base}/products?page=${page}&q=${encodeURIComponent(query)}`,
  );
  const wallet = useIssuing<Wallet>(base + "/wallet");
  const terms = useIssuing<Terms>(base + "/terms");
  const [product, setProduct] = useState<PublicProduct>();
  const [funding, setFunding] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [lawful, setLawful] = useState(false),
    [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const storage = pendingKey(uid, customerId);
  const [pending, setPending] = useState<PendingIssuing | null>(() =>
    readPending(storage),
  );
  const navigate = useNavigate();
  const guard = useRef(false);
  useEffect(() => {
    let active = true;
    setProduct(undefined);
    setQuote(undefined);
    setLawful(false);
    setAccepted(false);
    setError("");
    if (selected)
      api<PublicProduct>(base + "/products/" + selected)
        .then((p) => {
          if (active) {
            setProduct(p);
            setFunding(money(p.minimumMinor));
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [base, selected]);
  useEffect(() => {
    setQuote(undefined);
    setLawful(false);
    setAccepted(false);
  }, [funding, terms.data?.version]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = !!quote && Date.parse(quote.expiresAt) <= now;
  const sufficient =
    !!quote &&
    !!wallet.data &&
    BigInt(wallet.data.availableMinor) >= BigInt(quote.totalMinor);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "q") next.set("page", "1");
    setParams(next);
  }
  const [pricing, setPricing] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setQuote(undefined);
    setLawful(false);
    setAccepted(false);
    setPricing(false);
    if (!product || product.id !== selected || product.blockedReason || pending) return;
    setError("");
    let value: string;
    try {
      value = toMinor(funding);
      if (BigInt(value) < BigInt(product.minimumMinor)) throw new Error(`初始余额至少 USD ${money(product.minimumMinor)}`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setPricing(true);
    const timer = setTimeout(async () => {
      try {
        const q = await api<Quote>(base + "/quotes", { productId: product.id, fundingMinor: value });
        if (!active) return;
        setQuote(q);
        wallet.refresh();
        terms.refresh();
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setPricing(false);
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [base, selected, product, funding, pending, terms.data?.version, quoteRevision]);
  async function submit() {
    if (guard.current) return;
    if (
      !pending &&
      (!quote ||
        expired ||
        !sufficient ||
        !lawful ||
        !accepted ||
        quote.termsVersion !== terms.data?.version)
    )
      return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const request = pending || {
        key: crypto.randomUUID(),
        path: base + "/orders",
        body: {
          quoteId: quote!.id,
          termsVersion: quote!.termsVersion,
          lawfulUse: lawful,
          acceptedTerms: accepted,
        },
      };
      if (request.path !== base + "/orders")
        throw new Error("有待确认的首充请求，请先从开卡订单进入原卡处理");
      savePending(storage, request);
      setPending(request);
      const result = await api<Order>(request.path, request.body, request.key);
      sessionStorage.removeItem(storage);
      setPending(null);
      navigate("/portal/card-orders/" + result.id);
    } catch (e) {
      if (e instanceof IssuingError && [400, 409].includes(e.status)) {
        sessionStorage.removeItem(storage);
        setPending(null);
        setQuote(undefined);
        setLawful(false);
        setAccepted(false);
        wallet.refresh();
        terms.refresh();
      }
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2} sx={{ maxWidth: 1120 }}>
      <Stack component="ol" direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ m: 0, p: 0, listStyle: "none" }}>
        {([{ label: "选择卡片", icon: "card" }, { label: "设置余额", icon: "wallet" }, { label: "确认开卡", icon: "check" }] as const).map((step, index) => {
          const current = quote ? 2 : product ? 1 : 0;
          return <Stack component="li" key={step.icon} direction="row" alignItems="center" spacing={1} aria-current={index === current ? "step" : undefined} sx={{ flex: { xs: 1, sm: "0 0 auto" }, color: index <= current ? "primary.dark" : "text.secondary" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", bgcolor: index === current ? "primary.main" : "action.hover", color: index === current ? "primary.contrastText" : "inherit" }}><IssuingIcon name={index < current ? "check" : step.icon} size={16} /></Box>
            <Typography variant="body2" sx={{ fontSize: { xs: 12, sm: 14 }, fontWeight: index === current ? 600 : 400, whiteSpace: "nowrap" }}>{step.label}</Typography>
            {index < 2 && <Box aria-hidden="true" sx={{ width: { xs: 0, sm: 32 }, height: "1px", bgcolor: "divider", ml: 1 }} />}
          </Stack>;
        })}
      </Stack>
      {wallet.data?.mode === "isolated" && (
        <Alert severity="info">隔离验收环境 · 合成资金与模拟发卡</Alert>
      )}
      {wallet.data?.pilot && (
        <Alert severity="warning">真实开卡验收 · 仅 BIN {wallet.data.pilot.bin} 一张，首充 {money(wallet.data.pilot.fundingMinor)} USD，合计最多 {money(wallet.data.pilot.totalCapMinor)} USD。失败或结果未知请查看原订单，不会自动另开新卡。</Alert>
      )}
      {wallet.data?.executionEnabled === false && (
        <Alert severity="info">开卡服务尚未开放，当前可查看产品与历史订单。</Alert>
      )}
      {pending && (
        <Alert
          severity="warning"
          action={
            <Button disabled={busy} onClick={submit}>
              查询并恢复原请求
            </Button>
          }
        >
          上次支付结果尚未确认，请先恢复原请求。不会重新扣款或另开一张卡。
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: product ? "minmax(0,1fr) 360px" : "1fr",
          },
          gap: 3,
          maxWidth: 1120,
        }}
      >
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Stack
            component="form"
            direction="row"
            spacing={1}
            onSubmit={(e) => {
              e.preventDefault();
              update("q", search);
            }}
          >
            <TextField
              fullWidth
              label="搜索产品或 BIN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" startIcon={<IssuingIcon name="search" size={16} />}>搜索</Button>
          </Stack>
          <LoadError message={products.error} retry={products.refresh} />
          {!products.data && !products.error && <CircularProgress />}
          {!!products.data?.length && <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          {products.data?.slice(0, 50).map((p) => (
            <Box key={p.id} sx={{
              px: { xs: 2, md: 3 }, py: 2,
              borderBottom: "1px solid", borderColor: "divider",
              "&:last-child": { borderBottom: 0 },
              bgcolor: p.id === selected ? "action.selected" : "transparent",
            }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr auto", lg: product ? "1fr auto" : "minmax(200px,1fr) 140px 140px 100px" }, gap: 2, alignItems: "center" }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ display: "flex", width: 60, height: 40, flexShrink: 0, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", alignItems: "center", justifyContent: "center" }}>
                    {['visa', 'mastercard', 'master'].includes(p.network.toLowerCase()) ? <Box component="img" src={`/brand/payment/${p.network.toLowerCase() === 'visa' ? 'visa' : 'mastercard'}.svg`} alt={p.network.toLowerCase() === 'visa' ? 'Visa' : 'Mastercard'} sx={{ width: 42, height: 28, objectFit: "contain" }} /> : <Typography variant="caption">{p.network.toUpperCase()}</Typography>}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ overflowWrap: "anywhere", fontSize: 14 }}>{p.bin}</Typography>
                    <Typography variant="caption" color="text.secondary">USD · 虚拟卡</Typography>
                  </Box>
                </Stack>
                <Box sx={{ gridRow: { xs: 2, lg: product ? 2 : "auto" } }}>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}><IssuingIcon name="receipt" size={14} /><Typography variant="caption">开卡费</Typography></Stack>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>USD {money(p.feeMinor)}</Typography>
                </Box>
                <Box sx={{ gridRow: { xs: 2, lg: product ? 2 : "auto" } }}>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}><IssuingIcon name="wallet" size={14} /><Typography variant="caption">最低首充</Typography></Stack>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>USD {money(p.minimumMinor)}</Typography>
                </Box>
                {p.blockedReason ? <Chip size="small" icon={<IssuingIcon name="clock" size={14} />} label="暂未开放" sx={{ gridColumn: { xs: 2, lg: product ? 2 : "auto" }, gridRow: { xs: 1, lg: product ? 1 : "auto" }, bgcolor: "action.hover", color: "text.secondary", borderRadius: 1, fontSize: 12, "& .MuiChip-icon": { color: "inherit", ml: 1 } }} /> : <Button
                  size="small"
                  endIcon={<IssuingIcon name={p.id === selected ? "check" : "arrow"} size={16} />}
                  variant={p.id === selected ? "contained" : "outlined"}
                  disabled={!!p.blockedReason || busy || !!pending}
                  onClick={() => update("product", p.id)}
                  sx={{ gridColumn: { xs: 2, lg: product ? 2 : "auto" }, gridRow: { xs: 1, lg: product ? 1 : "auto" }, whiteSpace: "nowrap" }}
                >
                  {p.id === selected ? "已选择" : "选择"}
                </Button>}
              </Box>
              {(p.description || p.blockedReason) && <Box component="details" sx={{ mt: 1 }}>
                <Box component="summary" sx={{ cursor: "pointer", color: "text.secondary", fontSize: 12, width: "fit-content", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 3 } }}>产品说明{p.blockedReason ? "与开放状态" : ""}</Box>
                {p.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>{p.description}</Typography>}
                {p.blockedReason && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{reasons[p.blockedReason] || "暂不可办理"}</Typography>}
              </Box>}
            </Box>
          ))}
          </Paper>}
          {products.data?.length === 0 && (
            <Alert severity="info">
              暂无符合条件的产品。可调整搜索或联系运营。
            </Alert>
          )}
          {(page > 1 || (products.data?.length || 0) > 50) && <Pager
            page={page}
            next={(products.data?.length || 0) > 50}
            go={(n) => update("page", String(n))}
          />}
        </Stack>
        {product && <Paper variant="outlined" sx={{ p: {xs:2,md:3}, alignSelf: "start", minWidth:0, gridRow: { xs: 1, md: "auto" }, gridColumn: { xs: 1, md: 2 } }}>
          <Stack spacing={1.5}>
            <Typography variant="h6">开卡申请</Typography>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ pb: 2, borderBottom: "1px solid", borderColor: "divider" }}>
              {['visa', 'mastercard', 'master'].includes(product.network.toLowerCase()) && <Box component="img" src={`/brand/payment/${product.network.toLowerCase() === 'visa' ? 'visa' : 'mastercard'}.svg`} alt={product.network} sx={{ width: 46, height: 30, objectFit: "contain" }} />}
              <Box><Typography variant="subtitle1">{product.bin}</Typography><Typography variant="caption" color="text.secondary">USD 虚拟卡</Typography></Box>
            </Stack>
                {product.blockedReason && (
                  <Alert severity="warning">
                    {reasons[product.blockedReason] || "暂不可办理"}
                  </Alert>
                )}
                <TextField
                  label="初始卡余额 · USD"
                  value={funding}
                  disabled={busy || !!pending || !!product.blockedReason || !!wallet.data?.pilot}
                  onChange={(e) => setFunding(e.target.value)}
                  helperText={`开卡后转入卡内，最低 USD ${money(product.minimumMinor)}`}
                  inputProps={{ inputMode: "decimal" }}
                />
                {pricing && <Typography variant="body2" color="text.secondary" role="status">正在计算开卡费用…</Typography>}
                {!pricing && !pending && !product.blockedReason && (error || expired || (quote && quote.termsVersion !== terms.data?.version)) && <Button onClick={() => setQuoteRevision(v => v + 1)}>重新计算费用</Button>}
            {quote && (
              <>
                <Stack spacing={1.5} sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">开卡费</Typography><Typography variant="body2">USD {money(quote.feeMinor)}</Typography></Stack>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">转入卡内</Typography><Typography variant="body2">USD {money(quote.fundingMinor)}</Typography></Stack>
                  <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="subtitle2">本次支付</Typography><Typography variant="h6">USD {money(quote.totalMinor)}</Typography></Stack>
                </Stack>
                <LoadError message={wallet.error} retry={wallet.refresh} />
                <Typography variant="body2" color="text.secondary">
                  {wallet.data?.fundingSource === "funds_wallet" ? "从资金中心 USD 钱包扣除" : "从 USD 开卡钱包扣除"} · 可用余额 {wallet.error ? "暂不可查询" : wallet.data ? `USD ${money(wallet.data.availableMinor)}` : "查询中"}
                </Typography>
                <Typography variant="caption" color={expired ? "error" : "text.secondary"}>
                  {expired ? "费用已过期，请重新计算后确认" : `费用有效至 ${new Date(quote.expiresAt).toLocaleTimeString()}`}
                </Typography>
                {wallet.data && !wallet.error && !expired && !sufficient && (
                  <Alert severity="warning" action={wallet.data.fundingSource === "funds_wallet" ? <Button component={Link} to="/portal/funds/exchange" size="small">兑换 USD</Button> : undefined}>
                    余额不足，还需 USD{" "}
                    {money(
                      (
                        BigInt(quote.totalMinor) -
                        BigInt(wallet.data.availableMinor)
                      ).toString(),
                    )}
                  </Alert>
                )}
              </>
            )}
            {quote && <>
            <LoadError message={terms.error} retry={terms.refresh} />
            {terms.data && (
              <Box component="details">
                <Box component="summary" sx={{ cursor: "pointer" }}>
                  开卡条款与退款规则
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  发卡失败全额退回；发卡成功但首充失败仅退首充，可对原卡补充首充且不重复收开卡费。结果未知时等待核查。
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  版本：{terms.data.version}<br />{terms.data.text}
                </Typography>
              </Box>
            )}
            <FormControlLabel
              sx={{ alignItems: "flex-start", "& .MuiFormControlLabel-label": { fontSize: 12, lineHeight: 1.6, pt: 1 } }}
              control={
                <Checkbox
                  checked={lawful}
                  disabled={!quote || expired || busy || !!pending}
                  onChange={(e) => setLawful(e.target.checked)}
                />
              }
              label="我承诺仅将卡片用于合法用途，不用于诈骗、洗钱或其他违法活动。"
            />
            <FormControlLabel
              sx={{ alignItems: "flex-start", "& .MuiFormControlLabel-label": { fontSize: 12, lineHeight: 1.6, pt: 1 } }}
              control={
                <Checkbox
                  checked={accepted}
                  disabled={
                    !quote || expired || busy || !!pending || !terms.data
                  }
                  onChange={(e) => setAccepted(e.target.checked)}
                />
              }
              label="我已阅读并同意开卡及使用条款，确认本次费用、首充金额和失败退款规则。"
            />
            <Button
              variant="contained"
              onClick={submit}
              disabled={
                busy ||
                !!pending ||
                !quote ||
                expired ||
                !sufficient ||
                !!wallet.error ||
                !!terms.error ||
                !lawful ||
                !accepted ||
                quote.termsVersion !== terms.data?.version
              }
            >
              {busy
                ? "正在确认…"
                : `确认开卡 · USD ${quote ? money(quote.totalMinor) : "—"}`}
            </Button>
            </>}
          </Stack>
        </Paper>}
      </Box>
    </Stack>
  );
}
function RecordList({ base, cards }: { base: string; cards: boolean }) {
  const [params, setParams] = useSearchParams(),
    page = safePage(params.get(cards ? "issuedPage" : "page"));
  const rows = useIssuing<Order[]>(
    `${base}/${cards ? "cards" : "orders"}?page=${page}`,
  );
  const go = (n: number) => {
    const next = new URLSearchParams(params);
    next.set(cards ? "issuedPage" : "page", String(n));
    setParams(next);
  };
  return (
    <Paper variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}><Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Typography variant="h6">{cards ? "新开卡片" : "开卡订单"}</Typography><Button onClick={rows.refresh}>刷新记录</Button></Stack>
      <LoadError message={rows.error} retry={rows.refresh} />
      {!rows.data && !rows.error && <CircularProgress />}
      {rows.data?.length === 0 && (
        <Stack alignItems="center" spacing={1} sx={{py:4}}><Typography variant="subtitle2">{cards?"暂无新开卡片":"暂无开卡订单"}</Typography><Typography variant="body2" color="text.secondary">申请新卡后，可在这里查询办理结果。</Typography><Button component={Link} to="/portal/cards/new">浏览卡片产品</Button></Stack>
      )}
      {rows.data?.slice(0, 50).map((o) => (
        <Paper key={o.id} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography>
              {o.cardName || o.productName} · BIN {o.bin}{" "}
              {o.last4 ? `· 尾号 ${o.last4}` : ""}
            </Typography>
            <Typography>
              {o.pilot && o.state === "funding_failed" ? "首充失败 · 待核查" : (orderStatuses as Record<string, string>)[o.state] || o.state} ·
              首充 USD {money(o.fundingMinor)}
            </Typography>
            <Button
              component={Link}
              to={`/portal/${cards ? "issued-cards" : "card-orders"}/${o.id}`}
            >
              查看详情
            </Button>
          </Stack>
        </Paper>
      ))}
      <Pager page={page} next={(rows.data?.length || 0) > 50} go={go} />
    </Stack></Paper>
  );
}
function OrderDetail({
  base,
  id,
  uid,
  customerId,
}: {
  base: string;
  id: string;
  uid: string;
  customerId: string;
}) {
  const result = useIssuing<Order>(base + "/orders/" + id, 0, orderPending);
  return (
    <Stack spacing={2}>
      <Typography variant="h6">订单信息</Typography>
      <LoadError message={result.error} retry={result.refresh} />
      <Button onClick={result.refresh}>刷新处理结果</Button>
      {!result.data && !result.error && <CircularProgress />}
      {result.data && (
        <>
          <OrderSummary order={result.data} />
          {result.data.cardId && (
            <Button
              component={Link}
              to={"/portal/issued-cards/" + result.data.cardId}
            >
              查看卡片
            </Button>
          )}
          {result.data.state === "funding_failed" && !result.data.parentId && !result.data.pilot && (
            <RetryFunding
              base={base}
              order={result.data}
              uid={uid}
              customerId={customerId}
            />
          )}
          {result.data.parentId && (
            <Button
              component={Link}
              to={"/portal/card-orders/" + result.data.parentId}
            >
              返回原开卡订单
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
function RetryFunding({
  base,
  order,
  uid,
  customerId,
}: {
  base: string;
  order: Order;
  uid: string;
  customerId: string;
}) {
  const product = useIssuing<PublicProduct>(
      base + "/products/" + order.productId,
    ),
    wallet = useIssuing<Wallet>(base + "/wallet");
  const [amount, setAmount] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  const storage = pendingKey(uid, customerId),
    [pending, setPending] = useState(() => readPending(storage));
  const guard = useRef(false),
    navigate = useNavigate();
  useEffect(() => {
    if (product.data) setAmount(money(product.data.minimumMinor));
  }, [product.data]);
  async function submit() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      if (!pending && !accepted) throw new Error("请先确认本次充值金额");
      const request = pending || {
        key: crypto.randomUUID(),
        path: base + "/topups",
        body: { orderId: order.id, fundingMinor: toMinor(amount) },
      };
      if (
        request.path !== base + "/topups" ||
        request.body.orderId !== order.id
      )
        throw new Error("请先从对应订单恢复上次待确认请求");
      if (
        !pending &&
        (!product.data ||
          !wallet.data ||
          BigInt(String(request.body.fundingMinor)) <
            BigInt(product.data.minimumMinor) ||
          BigInt(String(request.body.fundingMinor)) >
            BigInt(wallet.data.availableMinor))
      )
        throw new Error("请检查最低首充和钱包余额");
      savePending(storage, request);
      setPending(request);
      const result = await api<Order>(request.path, request.body, request.key);
      sessionStorage.removeItem(storage);
      setPending(null);
      navigate("/portal/card-orders/" + result.id);
    } catch (e) {
      if (e instanceof IssuingError && [400, 409].includes(e.status)) {
        sessionStorage.removeItem(storage);
        setPending(null);
      }
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: {xs:2,md:3},minWidth:0 }}>
      <Stack spacing={2}>
        <Typography variant="h6">原卡补充首充 · 开卡费 USD 0.00</Typography>
        <LoadError message={product.error} retry={product.refresh} />
        <LoadError message={wallet.error} retry={wallet.refresh} />
        {error && <Alert severity="error">{error}</Alert>}
        <Typography>
          可用余额 USD {wallet.data ? money(wallet.data.availableMinor) : "—"}
        </Typography>
        <TextField
          label="充值金额 · USD"
          value={amount}
          disabled={busy || !!pending}
          onChange={(e) => {
            setAmount(e.target.value);
            setAccepted(false);
          }}
          helperText={`最低 USD ${product.data ? money(product.data.minimumMinor) : "—"}`}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={busy || !!pending}
            />
          }
          label={wallet.data?.fundingSource === "funds_wallet" ? "确认从资金中心 USD 钱包支付以上金额，补充至原卡" : "确认从 USD 开卡钱包支付以上金额，补充至原卡"}
        />
        <Button
          onClick={submit}
          disabled={
            busy ||
            (!pending &&
              (!accepted ||
                !product.data ||
                !wallet.data ||
                !!product.error ||
                !!wallet.error))
          }
        >
          {pending ? "恢复原充值请求" : "确认补充首充"}
        </Button>
      </Stack>
    </Paper>
  );
}
function CardDetail({ base, id }: { base: string; id: string }) {
  const card = useIssuing<IssuedCard>(base + "/cards/" + id);
  if(card.data?.projection)return <Navigate replace to={`/portal/cards/${card.data.projection.cardId}?${new URLSearchParams({connection:card.data.projection.connection,back:"/portal/cards"})}`}/>;
  return (
    <Stack spacing={2}>
      <Typography variant="h6">新开卡片信息</Typography>
      <LoadError message={card.error} retry={card.refresh} />
      <Button onClick={card.refresh}>刷新</Button>
      {card.data && (
        <>
          <Typography variant="h6">
            {card.data.order.cardName} · 尾号 {card.data.order.last4}
          </Typography>
          <Typography>
            内部卡分户余额 · USD{" "}
            {card.data.balanceStatus === "known"
              ? money(card.data.balanceMinor)
              : "暂不可确认"}
          </Typography>
          <Typography color="text.secondary">
            内部记账余额不等于渠道实时可用余额。
          </Typography>
          <Typography color="text.secondary">此卡尚未关联渠道详情，卡片操作和 CVV 查询暂不可用。</Typography>
          <OrderSummary order={card.data.order} />
          <Button component={Link} to={"/portal/card-orders/" + id}>
            查看开卡订单
          </Button>
        </>
      )}
    </Stack>
  );
}
