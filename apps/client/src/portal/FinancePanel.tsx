import {detailRowProps} from "../../../../packages/shared/src/portal/rowInteraction";
import { useEffect, useState, useRef, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { QRCodeSVG } from "qrcode.react";
import { FundsDashboard } from "./DashboardSections";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Tooltip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  asset,
  units,
  FINANCE_POLICY as policy,
  type State,
  type FinanceAction,
  type Currency,
  type Order,
} from "./model";

const sections = [
  ["overview", "资产总览"],
  ["deposit", "USDT 充值"],
  ["exchange", "兑换"],
  ["withdraw", "提现"],
  ["addresses", "收款地址"],
  ["history", "资金流水"],
];
const surface = {
  p: { xs: 2, md: 3 },
};
const twoColumns = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.5fr) minmax(0, 1fr)" },
  gap: 3,
};
function Status({ value }: { value: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={value}
      color={
        value === "已完成"
          ? "success"
          : ["失败", "已拒绝", "需核查"].includes(value)
            ? "error"
            : value === "已取消"
              ? "default"
              : "warning"
      }
    />
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="baseline"
      gap={2}
      py={1}
    >
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ textAlign: "right", overflowWrap: "anywhere", minWidth: 0 }}>
        {children}
      </Box>
    </Stack>
  );
}
export function FinancePanel({
  state,
  onAction,
  embeddedOrderId,
  returnTo,
}: {
  state: State;
  onAction: (action: FinanceAction) => string | Promise<string>;
  embeddedOrderId?: string;
  returnTo?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const section = embeddedOrderId
    ? "orders"
    : location.pathname.split("/")[3] || "overview";
  const orderId = embeddedOrderId || location.pathname.split("/")[4];
  const [amount, setAmount] = useState("");
  const [exchangeBusy,setExchangeBusy] = useState(false);
  const exchangeLock=useRef(false);
  const [from, setFrom] = useState<Currency>("USDT");
  const [quoteId, setQuoteId] = useState("");
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [verified, setVerified] = useState(false);
  const [review, setReview] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("全部");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const f = state.finance;
  const quote = f.quotes.find((q) => q.id === quoteId);
  const address = f.addresses.find((a) => a.id === selectedAddress);
  const order = f.orders.find((o) => o.id === orderId);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = async (action: FinanceAction, goToOrder = false) => {
    setError("");
    try {
      const id = await onAction(action);
      if (goToOrder) navigate(`/portal/funds/orders/${id}`);
      else setFeedback("演示状态已更新。");
      return id;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return "";
    }
  };
  const parse = (value: string, c: Currency) => units(value, c);
  const attempt = async (fn: () => unknown) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "请检查输入");
    }
  };
  const available = (c: Currency) => (c === "USD" ? state.balance : f.usdt);
  const submit =
    (callback: (data: FormData) => unknown) =>
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      attempt(() => callback(new FormData(event.currentTarget)));
    };
  const toAmount = (value: number, c: Currency) =>
    (value / (c === "USD" ? 100 : 1000000)).toFixed(c === "USD" ? 2 : 6);
  const editableAmount = (value: string) => {
    setAmount(value);
    setQuoteId("");
    setReview(false);
    setVerified(false);
  };
  const to: Currency = from === 'USDT' ? 'USD' : 'USDT';
  let exchangeInputError = '';
  if(amount){try{if(units(amount,from)>available(from))exchangeInputError='支付金额超过可用余额';}catch(e){exchangeInputError=e instanceof Error?e.message:'请输入有效金额';}}
  const quoteValid=Boolean(quote&&!quote.used&&now<quote.expires);
  const changeExchangeAsset=(value:Currency)=>{setFrom(value);editableAmount('');setError('');setFeedback('');};
  const exchangeAction=async(confirm=false)=>{
    if(exchangeLock.current)return;
    exchangeLock.current=true;setExchangeBusy(true);setFeedback('');
    try{
      if(confirm){if(!quote||!quoteValid)return;await run({type:'finance/exchange',quoteId:quote.id,now:Date.now()},true);}
      else{setQuoteId('');await attempt(async()=>{
        const value=parse(amount,from);if(value>available(from))throw new Error('支付金额超过可用余额');
        const id=await run({type:'finance/quote',from,amount:value,now:Date.now()});
        if(id){setQuoteId(id);setNow(Date.now());setFeedback('');}
      });}
    }finally{exchangeLock.current=false;setExchangeBusy(false);}
  };
  const assetOption=(currency:Currency)=><MenuItem key={currency} value={currency}><Stack direction="row" gap={1} alignItems="center"><Icon icon={currency==='USDT'?'cryptocurrency-color:usdt':'solar:dollar-minimalistic-bold-duotone'} width={24} color={currency==='USD'?'#0078D4':undefined}/><Typography component="span" variant="subtitle2">{currency}</Typography><Typography component="span" variant="body2" color="text.secondary">{currency==='USDT'?'Tether':'美元'}</Typography></Stack></MenuItem>;
  const filtered = f.orders.filter(
    (o) =>
      (filter === "全部" || o.kind === filter) &&
      (currency === "全部" ||
        o.currency === currency ||
        o.toCurrency === currency) &&
      (!start || o.created.slice(0, 10) >= start) &&
      (!end || o.created.slice(0, 10) <= end) &&
      `${o.id} ${o.target || ""} ${o.address || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const list = (orders: Order[]) => (
    <TableContainer>
      <Table sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            {[
              "订单 / 类型",
              "提交时间",
              "支付 / 申请金额",
              "到账金额 / 预计到账",
              "状态",
              "",
            ].map((t, i) => (
              <TableCell key={i}>{t}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id} hover {...detailRowProps(()=>navigate(`/portal/funds/orders/${o.id}`))}>
              <TableCell>
                <Typography variant="subtitle2">{o.kind}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {o.id}
                </Typography>
              </TableCell>
              <TableCell>{o.created}</TableCell>
              <TableCell>
                {asset(
                  o.kind === "提现" ? o.amount + o.fee : o.amount,
                  o.currency,
                )}
              </TableCell>
              <TableCell>
                <Typography variant="body2">
                  {asset(o.receive, o.toCurrency)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {o.status === "已完成"
                    ? "已到账"
                    : ["失败", "已取消", "已拒绝"].includes(o.status)
                      ? "未到账"
                      : "预计到账"}
                </Typography>
              </TableCell>
              <TableCell>
                <Status value={o.status} />
              </TableCell>
              <TableCell>
                <Button component={Link} to={`/portal/funds/orders/${o.id}`}>
                  详情
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!orders.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                暂无资金订单，充值、兑换或划拨后会显示在这里。
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
  const exportOrders = () => {
    const escape = (v: string) =>
      '"' + (/^[=+@\-\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"';
    const csv =
      "\uFEFF" +
      [
        [
          "订单",
          "类型",
          "时间",
          "支付币种",
          "支付/申请金额",
          "手续费",
          "到账币种",
          "到账金额",
          "状态",
          "地址",
          "交易哈希",
        ],
        ...filtered.map((o) => [
          o.id,
          o.kind,
          o.created,
          o.currency,
          toAmount(o.kind === "提现" ? o.amount + o.fee : o.amount, o.currency),
          toAmount(o.fee, o.currency),
          o.toCurrency,
          toAmount(o.receive, o.toCurrency),
          o.status,
          o.address || "",
          o.tx || "",
        ]),
      ]
        .map((r) => r.map(escape).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "moventra-demo-funds.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const actionsFor = (
    o: Order,
  ): [
    Extract<FinanceAction, { type: "finance/simulate" }>["event"],
    string,
  ][] => {
    if (o.kind === "充值")
      return o.status === "待检测"
        ? [["detect", "模拟检测到账"]]
        : o.status === "确认中"
          ? [
              ["review", "标记需核查"],
              ["complete", "模拟确认并入账"],
            ]
          : o.status === "需核查"
            ? [["complete", "核查通过并入账"]]
            : [];
    if (o.kind === "提现" && o.status === "待审核")
      return [
        ["approve", "模拟审核通过"],
        ["reject", "模拟审核拒绝"],
      ];
    if (
      ["提现", "兑换", "卡片转回"].includes(o.kind) &&
      ["处理中", "待核实"].includes(o.status)
    )
      return [
        ...(o.status === "处理中"
          ? [["unknown", "模拟超时待核实"] as ["unknown", string]]
          : []),
        ["complete", "模拟最终成功"],
        ["fail", "模拟确认失败"],
      ];
    return [];
  };
  const simulator = (o: Order) => (
    <Accordion
      variant="outlined"
      sx={{ mt: 3, boxShadow: "none", bgcolor: "grey.100" }}
    >
      <AccordionSummary expandIcon={<span>＋</span>}>
        <Typography variant="subtitle2">
          演示控制区 · 模拟后台与渠道结果
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Alert severity="warning" sx={{ mb: 2 }}>
          仅改变本地合成数据，不代表真实到账、审核或转账。客户正式页面不提供这些按钮。
        </Alert>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {actionsFor(o).map(([event, label]) => (
            <Button
              key={event}
              variant="outlined"
              onClick={() =>
                run({
                  type: "finance/simulate",
                  orderId: o.id,
                  event,
                  eventId: crypto.randomUUID(),
                })
              }
            >
              {label}
            </Button>
          ))}
          {!actionsFor(o).length && (
            <Typography color="text.secondary">
              订单已结束，无可执行的模拟事件。
            </Typography>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
  let withdrawalAmount = 0;
  try {
    withdrawalAmount = units(amount, "USDT");
  } catch {
    /* Inline validation occurs at review. */
  }
  return (
    <Stack gap={3}>
      {!embeddedOrderId && (
        <Tabs
          value={sections.some(([key]) => key === section) ? section : false}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="资金中心导航"
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          {sections.map(([key, label]) => (
            <Tab
              key={key}
              value={key}
              label={label}
              component={Link}
              to={`/portal/funds/${key}`}
            />
          ))}
        </Tabs>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {feedback && (
        <Alert severity="success" onClose={() => setFeedback("")}>
          {feedback}
        </Alert>
      )}
      {section === "overview" && (
        <FundsDashboard
          state={state}
          recentOrders={list(f.orders.slice(0, 5))}
        />
      )}
      {section === "deposit" && (
        <Box sx={twoColumns}>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={3}>
              充值 USDT
            </Typography>
            <Stack gap={3}>
              <TextField
                label="币种"
                value="USDT"
                InputProps={{ readOnly: true }}
              />
              <TextField select label="充值网络" value="tron">
                <MenuItem value="tron">{policy.network}</MenuItem>
              </TextField>
              <Alert severity="warning">
                演示专用地址不可接收资产。二维码仅包含 DEMO
                标识，请勿向任何演示页面转账。
              </Alert>
              <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                <QRCodeSVG
                  value={policy.depositAddress}
                  size={148}
                  title="演示标识二维码，不是钱包地址"
                />
              </Box>
              <TextField
                label="演示充值地址"
                value={policy.depositAddress}
                InputProps={{ readOnly: true }}
              />
              <Button
                variant="outlined"
                onClick={() => {
                  navigator.clipboard
                    .writeText(policy.depositAddress)
                    .then(() => setFeedback("演示标识已复制。"))
                    .catch(() =>
                      setError("复制失败，请选中地址文本手动复制。"),
                    );
                }}
              >
                复制演示地址
              </Button>
              <Box
                component="form"
                onSubmit={submit((d) =>
                  run(
                    {
                      type: "finance/deposit",
                      amount: parse(String(d.get("amount")), "USDT"),
                    },
                    true,
                  ),
                )}
              >
                <Stack gap={2}>
                  <TextField
                    required
                    fullWidth
                    name="amount"
                    label="预期充值数量 · USDT"
                    inputProps={{ inputMode: "decimal" }}
                    helperText="最低 10 USDT；支持 6 位小数"
                  />
                  <Button type="submit" variant="contained">
                    创建演示充值记录
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={2}>
              到账须知
            </Typography>
            <Field label="充值手续费">演示 0 USDT</Field>
            <Field label="网络与地址">仅此演示网络 / 会话</Field>
            <Field label="确认要求">演示控制区手动模拟</Field>
            <Divider sx={{ my: 2 }} />
            <Typography color="text.secondary" paragraph>
              创建记录不会增加余额。进入订单详情，在演示控制区依次模拟“检测到账”和“确认并入账”，然后可以兑换
              USD。
            </Typography>
            <Typography color="text.secondary">
              实际金额、地址有效期、确认数和支持网络须由渠道返回；正式业务按实际到账入账，不按客户填写金额入账。
            </Typography>
          </Paper>
        </Box>
      )}
      {section === "exchange" && (
        <Box sx={{...twoColumns,alignItems:'start'}}>
          <Paper variant="outlined" sx={surface}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3} gap={2}>
              <Box><Typography variant="h6">资产兑换</Typography><Typography variant="body2" color="text.secondary" mt={0.5}>选择支付与获得的资产，确认报价后兑换。</Typography></Box>
              <Chip size="small" variant="outlined" label="Demo" color="primary"/>
            </Stack>
            <Stack gap={2} component="form" onSubmit={e=>{e.preventDefault();if(amount&&!exchangeInputError)void exchangeAction(quoteValid);}}>
              <Box sx={{p:{xs:2,md:2.5},border:1,borderColor:'divider',borderRadius:2}}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} gap={1}>
                  <Typography variant="subtitle2">原始资产 · 您支付</Typography>
                  <Button size="small" disabled={exchangeBusy||available(from)<=0} onClick={()=>editableAmount(toAmount(available(from),from))}>使用全部</Button>
                </Stack>
                <TextField fullWidth select size="small" label="原始资产" value={from} disabled={exchangeBusy} onChange={e=>changeExchangeAsset(e.target.value as Currency)} sx={{mb:2}}>{(['USDT','USD'] as Currency[]).map(assetOption)}</TextField>
                <TextField fullWidth label="支付金额" placeholder="输入兑换数量" value={amount} disabled={exchangeBusy} onChange={e=>editableAmount(e.target.value)} error={Boolean(exchangeInputError)} inputProps={{inputMode:'decimal'}} InputProps={{endAdornment:<InputAdornment position="end">{from}</InputAdornment>}} sx={{'& input':{typography:'h5',fontVariantNumeric:'tabular-nums'}}} helperText={exchangeInputError||`可用 ${asset(available(from),from)} · 手续费包含在支付金额内`}/>
              </Box>
              <Stack direction="row" alignItems="center" gap={2} sx={{my:-0.5}}><Divider sx={{flex:1}}/><Tooltip title="切换兑换方向"><span><IconButton aria-label="切换兑换方向" disabled={exchangeBusy} onClick={()=>changeExchangeAsset(to)} sx={{border:1,borderColor:'divider',color:'primary.main'}}><Icon icon="solar:transfer-vertical-linear" width={22}/></IconButton></span></Tooltip><Divider sx={{flex:1}}/></Stack>
              <Box sx={{p:{xs:2,md:2.5},border:1,borderColor:'divider',borderRadius:2,bgcolor:'action.hover'}}>
                <Typography variant="subtitle2" mb={2}>获得资产 · 您收到</Typography>
                <TextField fullWidth select size="small" label="获得资产" value={to} disabled={exchangeBusy} onChange={e=>changeExchangeAsset(e.target.value==='USD'?'USDT':'USD')} sx={{mb:2}}>{(['USD','USDT'] as Currency[]).map(assetOption)}</TextField>
                <TextField fullWidth label="预计获得数量" value={quote?toAmount(quote.receive,quote.to):'—'} InputProps={{readOnly:true,endAdornment:<InputAdornment position="end">{to}</InputAdornment>}} sx={{'& input':{typography:'h4',color:quoteValid?'primary.main':'text.secondary',fontVariantNumeric:'tabular-nums'}}} helperText={quote?(quoteValid?'已扣除手续费 · 确认兑换后，处理成功才入账':'报价已失效，请重新获取'):'输入支付金额并获取报价后，显示预计到账数量'}/>
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>当前可用 {asset(available(to),to)}</Typography>
              </Box>
              {quote&&!quoteValid&&<Alert severity="warning">{quote.used?'该报价已使用，请重新获取。':'报价已过期，请重新获取后确认兑换。'}</Alert>}
              <Button type="submit" variant="contained" size="large" disabled={!amount||Boolean(exchangeInputError)||exchangeBusy} startIcon={exchangeBusy?<CircularProgress size={18} color="inherit"/>:undefined}>{exchangeBusy?'正在处理…':quoteValid?`确认兑换 · 获得 ${asset(quote!.receive,to)}`:quote?'重新获取报价':'获取兑换报价'}</Button>
              {quoteValid&&<Button disabled={exchangeBusy} onClick={()=>exchangeAction()}>刷新报价 · 剩余 {Math.max(0,Math.ceil((quote!.expires-now)/1000))} 秒</Button>}
            </Stack>
          </Paper>
          <Stack gap={3}>
            <Paper variant="outlined" sx={surface}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}><Typography variant="h6">兑换明细</Typography><Chip size="small" variant="outlined" label={quoteValid?'报价有效':quote?'报价失效':'待获取报价'} color={quoteValid?'success':'default'}/></Stack>
              <Field label="兑换方向">{from} → {to}</Field>
              <Field label="支付金额">{quote?asset(quote.amount,quote.from):'—'}</Field>
              <Field label={quote?.feeBps==null?"其中手续费":`其中手续费 · ${quote.feeBps/100}%`}>{quote?asset(quote.fee,quote.from):'—'}</Field>
              <Field label="用于兑换的净额">{quote?asset(quote.amount-quote.fee,quote.from):'—'}</Field>
              <Divider sx={{my:2}}/>
              <Field label="演示汇率">{quote?.rate?`1 ${quote.from} = ${quote.rate} ${quote.to}`:quote?'旧报价未提供汇率':'获取报价后显示'}</Field>
              <Field label="预计获得"><Typography component="span" variant="subtitle1" color={quoteValid?'primary.main':'text.secondary'}>{quote?asset(quote.receive,quote.to):'—'}</Typography></Field>
              <Typography variant="caption" color="text.secondary" display="block" mt={2}>手续费从原始资产中扣除，不另外收取。</Typography>
            </Paper>
            <Box sx={{px:{xs:0,md:1}}}>
              <Alert severity="info" sx={{mb:2}}>固定 Demo 汇率，仅用于模拟兑换。</Alert>
              <Typography variant="subtitle2" mb={1}>到账说明</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>报价有效期 60 秒。修改金额或资产后需重新报价；手续费向上取整、获得数量向下取整至对应资产的最小单位。</Typography>
              <Typography variant="body2" color="text.secondary">确认后预占原始资产，处理成功后增加获得资产。失败会释放预占金额，处理中可在资金订单中查看进度。</Typography>
            </Box>
          </Stack>
        </Box>
      )}
      {section === "withdraw" && (
        <Box sx={twoColumns}>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={3}>
              提现 USDT
            </Typography>
            {!f.addresses.some((a) => a.enabled) ? (
              <Alert severity="info">
                请先
                <Button component={Link} to="/portal/funds/addresses">
                  添加演示收款地址
                </Button>
                再发起提现。
              </Alert>
            ) : (
              <Stack gap={3}>
                <TextField
                  label="提现网络"
                  value={policy.network}
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  select
                  label="收款地址"
                  value={selectedAddress}
                  onChange={(e) => {
                    setSelectedAddress(e.target.value);
                    setReview(false);
                    setVerified(false);
                  }}
                >
                  {f.addresses
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.label} · {a.address}
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  label="收款人到账数量 · USDT"
                  value={amount}
                  onChange={(e) => editableAmount(e.target.value)}
                  inputProps={{ inputMode: "decimal" }}
                  helperText={`可用 ${asset(f.usdt, "USDT")}；手续费另扣 2 USDT`}
                />
                <Button
                  onClick={() =>
                    editableAmount(
                      toAmount(
                        Math.max(0, f.usdt - policy.withdrawalFee),
                        "USDT",
                      ),
                    )
                  }
                >
                  使用全部可提现余额
                </Button>
                {!review ? (
                  <Button
                    variant="contained"
                    onClick={() =>
                      attempt(() => {
                        const value = parse(amount, "USDT");
                        if (!address?.enabled)
                          throw new Error("请选择收款地址。");
                        if (
                          value < policy.minWithdraw ||
                          value > policy.maxWithdraw
                        )
                          throw new Error(
                            "演示单笔提现范围为 10–100,000 USDT。",
                          );
                        if (value + policy.withdrawalFee > f.usdt)
                          throw new Error("可用余额不足以支付提现和手续费。");
                        setReview(true);
                      })
                    }
                  >
                    核对提现信息
                  </Button>
                ) : (
                  <>
                    <Divider />
                    <Field label="完整收款地址">{address?.address}</Field>
                    <Field label="到账数量">
                      {asset(withdrawalAmount, "USDT")}
                    </Field>
                    <Field label="提现手续费">
                      {asset(policy.withdrawalFee, "USDT")}
                    </Field>
                    <Field label="本次总扣款">
                      {asset(withdrawalAmount + policy.withdrawalFee, "USDT")}
                    </Field>
                    <Field label="剩余可用余额">
                      {asset(
                        f.usdt - withdrawalAmount - policy.withdrawalFee,
                        "USDT",
                      )}
                    </Field>
                    <Alert severity="info">
                      以下勾选仅演示二次确认，不是实际身份验证。正式提现需服务端验证与授权。
                    </Alert>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={verified}
                          onChange={(e) => setVerified(e.target.checked)}
                        />
                      }
                      label="我已核对演示网络、地址、数量及费用"
                    />
                    <Button
                      variant="contained"
                      disabled={!verified}
                      onClick={() =>
                        run(
                          {
                            type: "finance/withdraw",
                            addressId: selectedAddress,
                            amount: withdrawalAmount,
                            verified,
                          },
                          true,
                        )
                      }
                    >
                      提交演示提现申请
                    </Button>
                  </>
                )}
              </Stack>
            )}
          </Paper>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={2}>
              处理进度
            </Typography>
            <Typography color="text.secondary" paragraph>
              提交后金额与手续费一并预占。待审核时可取消；审核通过进入渠道处理后不可取消。
            </Typography>
            <Typography color="text.secondary" paragraph>
              审核通过不等于提现完成。结果不明保持待核实，确认成功或失败后结算资金。
            </Typography>
            <Typography color="text.secondary">
              仅有 USD 时，请先兑换成 USDT。银行提现暂未接入。
            </Typography>
            <Button component={Link} to="/portal/funds/exchange" sx={{ mt: 2 }}>
              前往兑换
            </Button>
          </Paper>
        </Box>
      )}
      {section === "addresses" && (
        <Box sx={twoColumns}>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={3}>
              收款地址簿
            </Typography>
            {f.addresses.map((a) => (
              <Box
                key={a.id}
                sx={{ py: 2, borderBottom: 1, borderColor: "divider" }}
              >
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle1">{a.label}</Typography>
                  <Chip size="small" label={a.enabled ? "可用" : "已停用"} />
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: "anywhere", my: 1 }}
                >
                  {a.network}
                  <br />
                  {a.address}
                </Typography>
                <Button
                  onClick={() =>
                    run({ type: "finance/address-toggle", addressId: a.id })
                  }
                >
                  {a.enabled ? "停用" : "启用"}
                </Button>
              </Box>
            ))}
            {!f.addresses.length && (
              <Typography color="text.secondary">
                暂无地址，请在右侧添加。仅支持 DEMO 格式，不能用于实际转账。
              </Typography>
            )}
          </Paper>
          <Paper variant="outlined" sx={surface}>
            <Typography variant="h6" mb={3}>
              添加演示地址
            </Typography>
            <Box
              component="form"
              onSubmit={submit((d) =>
                run({
                  type: "finance/address",
                  label: String(d.get("label")),
                  address: String(d.get("address")),
                }),
              )}
            >
              <Stack gap={3}>
                <TextField
                  label="地址备注"
                  name="label"
                  required
                  inputProps={{ maxLength: 60 }}
                />
                <TextField
                  label="网络"
                  value={policy.network}
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="演示地址"
                  name="address"
                  required
                  placeholder="DEMO:TRON:my-wallet"
                  helperText="不接受真实钱包地址"
                />
                <Button type="submit" variant="contained">
                  保存演示地址
                </Button>
                <Typography variant="caption" color="text.secondary">
                  本版不收集验证码。正式新增地址需身份验证和服务端地址校验；启用等待期由平台策略决定。
                </Typography>
              </Stack>
            </Box>
          </Paper>
        </Box>
      )}
      {section === "history" && (
        <Paper variant="outlined" sx={surface}>
          <Stack direction={{ xs: "column", md: "row" }} gap={2} mb={2}>
            <TextField
              label="订单号、地址或名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="类型"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              {[
                "全部",
                "充值",
                "兑换",
                "提现",
                "卡片充值",
                "卡片转回",
                "内部划拨",
              ].map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="币种"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              {["全部", "USDT", "USD"].map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} gap={2} mb={3}>
            <TextField
              type="date"
              label="开始日期"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="date"
              label="结束日期"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              onClick={() => {
                setSearch("");
                setFilter("全部");
                setCurrency("全部");
                setStart("");
                setEnd("");
              }}
            >
              清除筛选
            </Button>
            <Button variant="outlined" onClick={exportOrders}>
              导出当前筛选 CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            订单中的预计到账金额不代表已经入账，请以状态为准。
          </Typography>
          {list(filtered)}
        </Paper>
      )}
      {section === "orders" &&
        (order ? (
          <>
            <Button
              component={Link}
              to={returnTo || "/portal/funds/history"}
              sx={{ alignSelf: "flex-start" }}
            >
              ← {returnTo ? "返回卡片详情" : "返回资金流水"}
            </Button>
            <Box sx={twoColumns}>
              <Paper variant="outlined" sx={surface}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  mb={3}
                >
                  <Typography variant="h6">{order.kind}详情</Typography>
                  <Status value={order.status} />
                </Stack>
                <Field label="订单编号">{order.id}</Field>
                <Field label="提交时间">{order.created}</Field>
                <Field
                  label={
                    order.kind === "提现" ? "到账申请金额" : "支付 / 申请金额"
                  }
                >
                  {asset(order.amount, order.currency)}
                </Field>
                <Field
                  label={
                    order.kind === "兑换"
                      ? "其中手续费"
                      : order.kind === "提现"
                        ? "另扣手续费"
                        : "手续费"
                  }
                >
                  {asset(order.fee, order.currency)}
                </Field>
                {order.kind === "提现" && (
                  <Field label="本次总扣款">
                    {asset(order.amount + order.fee, order.currency)}
                  </Field>
                )}
                <Field
                  label={order.status === "已完成" ? "最终到账" : "预计到账"}
                >
                  {asset(order.receive, order.toCurrency)}
                </Field>
                {order.network && <Field label="网络">{order.network}</Field>}
                {order.address && (
                  <Field label="完整地址">{order.address}</Field>
                )}
                {order.tx && <Field label="模拟交易标识">{order.tx}</Field>}
                {order.quoteId && (
                  <Field label="锁定报价编号">{order.quoteId}</Field>
                )}
                {order.target && <Field label="关联对象">{order.target}</Field>}
                {order.kind === "提现" && order.status === "待审核" && (
                  <Button
                    variant="outlined"
                    color="error"
                    sx={{ mt: 3 }}
                    onClick={() =>
                      run({ type: "finance/cancel", orderId: order.id })
                    }
                  >
                    取消申请并释放资金
                  </Button>
                )}
                {order.status === "待核实" && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    渠道结果未明确，资金保持预占，请等待核查，不要重复提交。
                  </Alert>
                )}
              </Paper>
              <Paper variant="outlined" sx={surface}>
                <Typography variant="h6" mb={3}>
                  处理时间线
                </Typography>
                {order.history.map((h, i) => (
                  <Box
                    key={i}
                    sx={{
                      pb: 3,
                      pl: 2,
                      borderLeft: 2,
                      borderColor:
                        i === order.history.length - 1
                          ? "primary.main"
                          : "divider",
                    }}
                  >
                    <Typography variant="body2">{h.text}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {h.time}
                    </Typography>
                  </Box>
                ))}
                <Button
                  component={Link}
                  to={`/portal/support?order=${encodeURIComponent(order.id)}`}
                >
                  联系客服
                </Button>
              </Paper>
            </Box>
            {simulator(order)}
          </>
        ) : (
          <Alert severity="warning">未找到资金订单，请返回资金流水。</Alert>
        ))}
      {!sections.some(([key]) => key === section) && section !== "orders" && (
        <Alert severity="warning">未找到该资金页面，请从上方导航选择。</Alert>
      )}
    </Stack>
  );
}
