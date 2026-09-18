import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
    <Stack direction="row" spacing={2} alignItems="center">
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
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button component={Link} to="/portal/cards/new" variant="contained">
          开卡
        </Button>
        <Button component={Link} to="/portal/card-orders">
          开卡订单
        </Button>
        <Button component={Link} to="/portal/cards">
          卡片中心
        </Button>
      </Stack>
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
  async function getQuote() {
    if (!product) return;
    setBusy(true);
    setError("");
    setLawful(false);
    setAccepted(false);
    try {
      const value = toMinor(funding);
      if (BigInt(value) < BigInt(product.minimumMinor))
        throw new Error("首充不能低于最低金额");
      const q = await api<Quote>(base + "/quotes", {
        productId: product.id,
        fundingMinor: value,
      });
      setQuote(q);
      terms.refresh();
      wallet.refresh();
    } catch (e) {
      setQuote(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
    <Stack spacing={2}>
      <Typography variant="h4">申请新卡</Typography>
      {wallet.data?.mode === "isolated" && (
        <Alert severity="info">隔离验收环境 · 合成资金与模拟发卡</Alert>
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
            md: "minmax(0,1.4fr) minmax(320px,1fr)",
          },
          gap: 3,
        }}
      >
        <Stack spacing={2}>
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
            <Button type="submit">搜索</Button>
          </Stack>
          <LoadError message={products.error} retry={products.refresh} />
          {!products.data && !products.error && <CircularProgress />}
          {products.data?.slice(0, 50).map((p) => (
            <Paper
              variant="outlined"
              key={p.id}
              sx={{
                p: 2.5,
                borderColor: p.id === selected ? "primary.main" : "divider",
              }}
            >
              <Stack spacing={1}>
                <Typography variant="h6">{p.name}</Typography>
                <Typography>
                  BIN {p.bin} · {p.network.toUpperCase()} · USD 虚拟卡
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ whiteSpace: "pre-wrap" }}
                >
                  {p.description || "暂无补充介绍"}
                </Typography>
                <Typography>
                  开卡费 USD {money(p.feeMinor)} · 最低首充 USD{" "}
                  {money(p.minimumMinor)}
                </Typography>
                {p.blockedReason && (
                  <Typography color="text.secondary">
                    {reasons[p.blockedReason] || "暂不可办理"}
                  </Typography>
                )}
                <Button
                  variant={p.id === selected ? "contained" : "outlined"}
                  disabled={!!p.blockedReason || busy || !!pending}
                  onClick={() => update("product", p.id)}
                >
                  {p.id === selected ? "已选择" : "选择此 BIN"}
                </Button>
              </Stack>
            </Paper>
          ))}
          {products.data?.length === 0 && (
            <Alert severity="info">
              暂无符合条件的产品。可调整搜索或联系运营。
            </Alert>
          )}
          <Pager
            page={page}
            next={(products.data?.length || 0) > 50}
            go={(n) => update("page", String(n))}
          />
        </Stack>
        <Paper variant="outlined" sx={{ p: 3, alignSelf: "start" }}>
          <Stack spacing={2}>
            <Typography variant="h6">确认费用与首充</Typography>
            <LoadError message={wallet.error} retry={wallet.refresh} />
            <Typography>
              USD 开卡钱包可用余额：
              {wallet.error
                ? "暂不可查询"
                : wallet.data
                  ? money(wallet.data.availableMinor)
                  : "查询中"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              余额不足请联系运营核对并补足到账资金。
            </Typography>
            {product ? (
              <>
                <Typography>
                  {product.name} · BIN {product.bin}
                </Typography>
                {product.blockedReason && (
                  <Alert severity="warning">
                    {reasons[product.blockedReason] || "暂不可办理"}
                  </Alert>
                )}
                <TextField
                  label="首充金额 · USD"
                  value={funding}
                  disabled={busy || !!pending}
                  onChange={(e) => setFunding(e.target.value)}
                  helperText={`最低 USD ${money(product.minimumMinor)}，最多两位小数`}
                  inputProps={{ inputMode: "decimal" }}
                />
                <Button
                  onClick={getQuote}
                  disabled={busy || !!pending || !!product.blockedReason}
                >
                  获取最新费用
                </Button>
              </>
            ) : (
              <Typography color="text.secondary">请先选择 BIN 产品</Typography>
            )}
            {quote && (
              <>
                <Typography>开卡费：USD {money(quote.feeMinor)}</Typography>
                <Typography>首充：USD {money(quote.fundingMinor)}</Typography>
                <Typography variant="h6">
                  合计：USD {money(quote.totalMinor)}
                </Typography>
                <Typography color={expired ? "error" : "text.secondary"}>
                  {expired
                    ? "报价已过期，请重新获取"
                    : `报价有效至 ${new Date(quote.expiresAt).toLocaleTimeString()}`}
                </Typography>
                {wallet.data && !sufficient && (
                  <Alert severity="warning">
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
            <Alert severity="info">
              发卡失败全额退回；发卡成功但首充失败仅退首充，可对原卡补充首充且不重复收开卡费。结果未知时等待核查。
            </Alert>
            <LoadError message={terms.error} retry={terms.refresh} />
            {terms.data && (
              <Box component="details">
                <Box component="summary" sx={{ cursor: "pointer" }}>
                  阅读开卡及使用条款 · {terms.data.version}
                </Box>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {terms.data.text}
                </Typography>
              </Box>
            )}
            <FormControlLabel
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
                : `确认支付 USD ${quote ? money(quote.totalMinor) : "—"} 并开卡`}
            </Button>
          </Stack>
        </Paper>
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
    <Stack spacing={2}>
      <Typography variant="h5">{cards ? "本次开卡" : "开卡订单"}</Typography>
      <LoadError message={rows.error} retry={rows.refresh} />
      <Button onClick={rows.refresh}>刷新记录</Button>
      {!rows.data && !rows.error && <CircularProgress />}
      {rows.data?.length === 0 && (
        <Typography color="text.secondary">暂无记录</Typography>
      )}
      {rows.data?.slice(0, 50).map((o) => (
        <Paper key={o.id} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography>
              {o.cardName || o.productName} · BIN {o.bin}{" "}
              {o.last4 ? `· 尾号 ${o.last4}` : ""}
            </Typography>
            <Typography>
              {(orderStatuses as Record<string, string>)[o.state] || o.state} ·
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
    </Stack>
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
      <Typography variant="h4">开卡订单详情</Typography>
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
          {result.data.state === "funding_failed" && !result.data.parentId && (
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
    <Paper variant="outlined" sx={{ p: 3 }}>
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
          label="确认从 USD 开卡钱包支付以上金额，补充至原卡"
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
  return (
    <Stack spacing={2}>
      <Typography variant="h4">新开卡片详情</Typography>
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
          <OrderSummary order={card.data.order} />
          <Button component={Link} to={"/portal/card-orders/" + id}>
            查看开卡订单
          </Button>
        </>
      )}
    </Stack>
  );
}
