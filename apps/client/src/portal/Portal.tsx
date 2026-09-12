import { workspaceNavigation, workspaceWidth } from "./workspaceNavigation";
import {retiredTeamPath} from "../../../../packages/shared/src/portal/personalV1";
import MessageCenter from './MessageCenter';
import {CardOpeningPage} from '../bins/CardOpeningPage';
import {detailRowProps} from "../../../../packages/shared/src/portal/rowInteraction";
import { BrandLogo } from '../../../../packages/shared/src/components/BrandLogo';
import { lazy, Suspense, useEffect, useState, useRef, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import {
  initialState,
  transition,
  cents,
  money,
  type Action,
  type Entry,
  type FinanceAction,
  asset,
} from "./model";
import {readPortal,writePortal} from "./unifiedApi";
import {UnifiedTransactions,UnifiedTransactionDetail} from "./UnifiedTransactions";
import type {State} from "./model";
import { FinancePanel } from "./FinancePanel";
import { CardCenter } from "./CardCenter";
import { cardHref } from "./cardQuery";
import { PageHeader } from "../../../../packages/shared/src/components/PageHeader";
import { OverviewDashboard } from "./DashboardSections";

const SlashSourcePage = lazy(() => import('../../../../packages/shared/src/slash/SourceDemoPage'));
const localSlashAvailable = (import.meta.env.DEV || import.meta.env.VITE_DATA_MODE === 'slash-demo') && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
const nav = workspaceNavigation;
const titles: Record<string, string> = {
  deposit: "充值申请",
  open: "申请新卡",
  topup: "充值到卡",
  return: "资金转回账户",
  ticket: "提交问题",
  onboard: "开户资料",
};
const panel = {
  p: { xs: 2, md: 3 },
  mb: 3,
};
function Badge({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={status}
      color={
        ["已完成", "使用中"].includes(status)
          ? "success"
          : status.includes("冻结") || status === "失败"
            ? "error"
            : "warning"
      }
    />
  );
}
export default function Portal() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Moventra 客户工作台";
    return () => {
      document.title = previous;
    };
  }, []);
  const [state, setState] = useState(initialState);
  const [entered, setEntered] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [op, setOp] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Entry | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.split("/")[2] || "overview";
  const [loaded,setLoaded] = useState(!localSlashAvailable);
  const actionBusy=useRef(false);
  useEffect(() => {
    if(!localSlashAvailable)return;
    let active=true;
    readPortal<State>('state').then(data=>{if(active){setState(data);setLoaded(true);}}).catch(e=>{if(active)setError(`本地 Demo 数据加载失败：${e.message}。请启动 npm run slash:demo 后刷新。`);});
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!localSlashAvailable)return;
    let active=true;
    const refresh=async()=>{if(document.visibilityState!=='visible'||actionBusy.current)return;try{const data=await readPortal<State>('state');if(active&&!actionBusy.current)setState(previous=>(data.revision??0)>=(previous.revision??0)?data:previous);}catch{/* Existing state remains; writes always revalidate on server. */}};
    const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  useEffect(()=>{
    const retired=retiredTeamPath(location.pathname);
    if(retired){navigate(retired,{replace:true});return;}
    const params=new URLSearchParams(location.search);
    for(const key of ["team","teamId","invite","invitation","inviteToken"])params.delete(key);
    params.delete('source');if(params.toString()!==location.search.slice(1))navigate(`${location.pathname}${params.size?'?'+params:''}`,{replace:true});
  },[location.pathname,location.search,navigate]);
  const sourcePage = localSlashAvailable && ['risk','reports','reconciliation'].includes(page);
  const cardId = location.pathname.split("/")[3];
  const open = (value: string) => {
    setError("");
    if (value === "deposit") {
      navigate("/portal/funds/deposit");
      return;
    }
    if(value==="open"){navigate("/portal/cards/new");return;}
    setOp(value);
  };
  const exit = () => {
    if(!localSlashAvailable)setState(initialState());
    setEntered(false);
    setOp("");
    setDetail(null);
    setNotice("");
    setError("");
    navigate("/portal");
  };
  const applyAction = async (action:Action) => {
    if(actionBusy.current)throw new Error('上一笔操作正在保存，请稍候');
    actionBusy.current=true;
    try {
      if(localSlashAvailable){
        if(!loaded)throw new Error('请等待本地数据加载完成');
        const result=await writePortal(action,state.revision??0);setState(result.state);return result.id;
      }
      const id=`DEMO-${crypto.randomUUID().slice(0,8)}`;
      setState(transition(state,action,id,new Date().toISOString()));return id;
    } catch(e){
      if(localSlashAvailable)try{setState(await readPortal<State>('state'));}catch{/* Keep the original action error visible. */}
      throw e;
    } finally {actionBusy.current=false;}
  };
  const act = async (action:Action) => {
    try{await applyAction(action);setOp('');setError('');setNotice(localSlashAvailable?'演示操作已保存，可在交易与账单中查询。':'演示操作已记录。');}
    catch(e){setError(e instanceof Error?e.message:'操作失败');}
  };
  const financeAct = (action:FinanceAction) => applyAction(action);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const v = (key: string) => String(f.get(key) || "").trim();
    try {
      if (op === "return") {
        const id = await financeAct({
          type: "finance/card-return",
          cardId: v("card"),
          amount: cents(v("amount")),
        });
        setOp("");
        if (page === "cards" && cardId) {
          const params = new URLSearchParams(location.search);
          params.set("tab", "funds");
          navigate(cardHref(v("card"), params, id));
        } else navigate(`/portal/funds/orders/${id}`);
      }
      if (op === "topup")
        act({
          type: "topup",
          id: v("card"),
          amount: cents(v("amount")),
          source: "main",
        });
      if (op === "open")
        act({ type: "open", name: v("name") });
      if (op === "onboard")
        act({ type: "onboard", name: v("name"), email: v("email") });
      if (op === "ticket") act({ type: "ticket", text: v("description") });
    } catch (e) {
      setError(e instanceof Error ? e.message : "请检查输入");
    }
  };
  const entries = state.entries.filter(
    (e) =>
      (status === "全部" || status === e.status) &&
      `${e.id} ${e.name} ${e.card || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const exportCsv = () => {
    const escape = (s: string) =>
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    const csv =
      "\uFEFF" +
      [
        ["编号", "时间", "名称", "类型", "金额", "币种", "状态"],
        ...entries.map((e) => [
          e.id,
          e.time,
          e.name,
          e.kind,
          (e.amount / (e.currency === "USDT" ? 1000000 : 100)).toFixed(
            e.currency === "USDT" ? 6 : 2,
          ),
          e.currency || "USD",
          e.status,
        ]),
      ]
        .map((row) => row.map(escape).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "moventra-demo-statement.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openEntry=(entry:Entry)=>state.unified ? navigate(`/portal/transactions/${encodeURIComponent(entry.id)}`) : entry.orderId ? navigate(`/portal/funds/orders/${entry.orderId}`) : setDetail(entry);
  const table = (rows: Entry[]) => (
    <TableContainer>
      <Table sx={{ minWidth: 650 }}>
        <TableHead>
          <TableRow>
            {["交易 / 商户", "时间", "类型", "金额 / 币种", "状态", "详情"].map(
              (t) => (
                <TableCell key={t}>{t}</TableCell>
              ),
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id} hover {...detailRowProps(()=>openEntry(e))}>
              <TableCell>
                <Typography variant="subtitle2">{e.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {e.id}
                  {e.card ? ` · ${e.card.slice(-4)}` : ""}
                </Typography>
              </TableCell>
              <TableCell>{e.time}</TableCell>
              <TableCell>{e.kind}</TableCell>
              <TableCell>{asset(e.amount, e.currency)}</TableCell>
              <TableCell>
                <Badge status={e.statusText||e.status} />
              </TableCell>
              <TableCell>
                <Button
                  onClick={()=>openEntry(e)}
                >
                  查看
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6} align="center">
                暂无符合条件的记录
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
  if(page==='customers')return <Navigate to="/portal/funds" replace/>;
  if(page==='demo')return <Navigate to="/portal/transactions" replace/>;
  if(entered&&!loaded)return <Container sx={{py:6}}><Alert severity={error?'error':'info'}>{error||'正在加载卡片、交易与资金订单…'}</Alert><Button onClick={()=>window.location.reload()}>重新加载</Button></Container>;
  if (!entered)
    return (
      <Container maxWidth="md" sx={{ py: { xs: 6, md: 12 } }}>
        <BrandLogo width={230} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          CLIENT WORKSPACE
        </Typography>
        <Typography variant="h3" mt={6} mb={2}>
          让每一笔投放支出，
          <br />
          都有清晰的去向。
        </Typography>
        <Typography color="text.secondary" mb={5}>
          在一个工作台管理资金与卡片。从补充预算，到核对账单。
        </Typography>
        <Paper variant="outlined" sx={panel}>
          <Typography variant="h5" mb={2}>
            客户工作台演示
          </Typography>
          <Alert severity="info" sx={{ mb: 3 }}>
            {localSlashAvailable ? '原资金流程已融合场景卡片与交易，可查询消费、退款、拒绝和撤销记录。数据仅在本地演示环境保存。' : '合成数据，不连接真实客户账户。所有操作仅保留在页面内存中，请勿填写真实资料。'}
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <Button
              variant="contained"
              onClick={() => {
                setEntered(true);
                if (!nav.some(([p]) => p === page))
                  navigate("/portal/overview");
              }}
            >
              进入演示工作台
            </Button>
            <Button component={Link} to="/login">
              运营后台登录
            </Button>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            mt={2}
          >
            个人账户演示 · 真实登录与找回密码待客户认证接口接入
          </Typography>
        </Paper>
      </Container>
    );
  const navigation = (
    <Box
      sx={{ p: 2.5, display: "flex", flexDirection: "column", height: "100%" }}
    >
      <Box sx={{ py: 2 }}>
        <BrandLogo width={190} />
      </Box>
      <Typography variant="caption" color="text.secondary" mb={4}>
        客户工作台 / CLIENT WORKSPACE
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2">{"Demo 个人账户"}</Typography>
        <Typography variant="caption" color="text.secondary">
          个人账户 · 本地演示
        </Typography>
      </Paper>
      <List
        component="div"
        aria-label="客户工作台菜单"
        disablePadding
        sx={{ display: "grid", gap: 0.5 }}
      >
        {nav.map(([p, label, icon]) => (
          <ListItemButton
            key={p}
            component={Link}
            to={`/portal/${p}`}
            selected={p === page}
            aria-current={p === page ? "page" : undefined}
            onClick={() => {
              setMobile(false);
              setQuery("");
              setStatus("全部");
            }}
          >
            <ListItemIcon>
              <Icon icon={icon} width={20} />
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{
                variant: "body2",
                fontWeight: p === page ? 600 : 500,
              }}
            />
            {p === "messages" && (
              <Chip
                size="small"
                label={state.notices.filter((n) => !n.read).length}
              />
            )}
          </ListItemButton>
        ))}
      </List>
      <Box mt="auto" pt={5}>
        <Typography variant="caption" color="text.secondary">
          {state.unified ? 'Demo · 本地持久化数据' : 'Demo · 模拟数据'}
        </Typography>
        <Button onClick={exit} fullWidth>
          退出演示
        </Button>
      </Box>
    </Box>
  );
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box
        component="nav"
        aria-label="客户导航"
        sx={{
          display: { xs: "none", lg: "block" },
          width: workspaceWidth,
          position: "fixed",
          inset: "0 auto 0 0",
          bgcolor: "background.paper",
          borderRight: 1,
          borderColor: "divider",
        }}
      >
        {navigation}
      </Box>
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        PaperProps={{ sx: { width: 270 } }}
      >
        {navigation}
      </Drawer>
      <Box sx={{ ml: { lg: `${workspaceWidth}px` } }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={2}
          sx={{
            px: 3,
            py: 2,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <IconButton
            aria-label="打开导航"
            onClick={() => setMobile(true)}
            sx={{ display: { lg: "none" } }}
          >
            <Icon icon="solar:hamburger-menu-linear" />
          </IconButton>
          <Typography variant="body2" color="text.secondary">
            工作空间 / {nav.find(([p]) => p === page)?.[1]}
          </Typography>
          <Box flex={1} />
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={'Demo / 模拟数据'}
          />
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: "primary.dark",
              fontSize: 12,
            }}
          >
            DP
          </Avatar>
        </Stack>
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Alert severity="info" sx={{ mb: 3 }}>
            {state.unified ? 'Demo / 模拟数据 · 卡片、消费与资金订单统一查询，本地保存。内部钱包和卡预算与 Slash 来源账户余额分别核算。' : 'Demo / 模拟数据 · 不发生真实资金操作'}
          </Alert>
          {error && !op && (
            <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert
              severity="success"
              onClose={() => setNotice("")}
              sx={{ mb: 2 }}
            >
              {notice}
            </Alert>
          )}
          {sourcePage && <Suspense fallback={<Typography>正在加载 Slash 数据页面…</Typography>}><SlashSourcePage/></Suspense>}
          {!sourcePage && <PageHeader
            description={
              page === "overview"
                ? "Demo 个人账户 · 管理投放资金与卡片预算"
                : page === "funds"
                  ? "查看分币种资产，追踪每一笔资金流转"
                  : undefined
            }
            title={
              page === "cards"&&cardId==="new"?"选择卡产品并开卡":page === "overview"
                ? "工作台"
                : nav.find(([p]) => p === page)?.[1] || "页面不存在"
            }
            action={
              <>
                {page === "overview" && (
                  <Button variant="contained" onClick={() => open("deposit")}>
                    充值申请
                  </Button>
                )}
                {page === "cards" && !cardId && (
                  <Button variant="contained" onClick={() => open("open")}>
                    申请新卡
                  </Button>
                )}
                {!sourcePage && !state.unified && page === "transactions" && (
                  <Button variant="outlined" onClick={exportCsv}>
                    导出 CSV
                  </Button>
                )}
                {page === "support" && (
                  <Button variant="contained" onClick={() => open("ticket")}>
                    提交问题
                  </Button>
                )}
              </>
            }
          />}
          {!sourcePage && page === "overview" && (
            <OverviewDashboard
              state={state}
              onOperation={open}
              transactions={table(state.entries.slice(0, 5))}
            />
          )}
          {!sourcePage && page === "funds" && (
            <FinancePanel
              key={location.pathname}
              state={state}
              onAction={financeAct}
            />
          )}
          {!sourcePage && page === "cards" && cardId==="new" && <CardOpeningPage state={state} onAction={applyAction}/>}
          {!sourcePage && page === "cards" && cardId!=="new" && (
            <CardCenter
              state={state}
              onFreeze={(id) => act({ type: "freeze", id })}
              onFinance={financeAct}
              onOperation={(operation, id) => {
                setDetail(null);
                navigate(cardHref(id, new URLSearchParams(location.search)));
                open(operation);
              }}
            />
          )}
          {state.unified && page === 'transactions' && (cardId ? <UnifiedTransactionDetail key={cardId} id={decodeURIComponent(cardId)} state={state} onFinance={financeAct}/> : <UnifiedTransactions state={state}/>)}
          {!sourcePage && !state.unified && page === "transactions" && (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} gap={2} mb={3}>
                <TextField
                  label="搜索商户、卡片尾号或交易号"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <TextField
                  select
                  label="状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  {["全部", "已完成", "处理中", "失败"].map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Paper variant="outlined" sx={panel}>
                {table(entries)}
              </Paper>
            </>
          )}
          {page === "messages" && <MessageCenter state={state} onAction={applyAction}/>}
          {page === "support" && (
            <>
              <Paper variant="outlined" sx={panel}>
                <Typography variant="h6" mb={3}>
                  常见问题
                </Typography>
                <Typography variant="subtitle1">
                  充值为什么没有增加余额？
                </Typography>
                <Typography color="text.secondary" mb={3}>
                  申请提交后需要核实到账。演示不会连接渠道，请在资金订单详情的演示控制区模拟确认入账。
                </Typography>
                <Typography variant="subtitle1">风控冻结如何处理？</Typography>
                <Typography color="text.secondary">
                  从卡片详情提交问题，由运营核实后处理，客户无法自行解除。
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={panel}>
                <Typography variant="h6" mb={2}>
                  我的问题
                </Typography>
                {state.tickets.length ? (
                  state.tickets.map((t, i) => (
                    <Box key={i} py={2}>
                      <Chip size="small" label="演示待处理" />
                      <Typography mt={1} sx={{ overflowWrap: "anywhere" }}>
                        {t}
                      </Typography>
                    </Box>
                  ))
                ) : (
                  <Typography color="text.secondary">
                    暂无问题记录，可以从交易详情发起反馈。
                  </Typography>
                )}
              </Paper>
            </>
          )}
          {page === "settings" && (
            <>
              <Paper variant="outlined" sx={panel}>
                <Typography variant="h6" mb={2}>
                  开户资料
                </Typography>
                <Badge status={state.onboarding} />
                {state.application && (
                  <Typography mt={2}>
                    {state.application.name} · {state.application.email}
                  </Typography>
                )}
                <Typography color="text.secondary" my={3}>
                  演示组织已预置资产，可独立体验开户资料提交。资料审核通过和服务开通是不同步骤。
                </Typography>
                <Button
                  variant="outlined"
                  disabled={state.onboarding === "待审核"}
                  onClick={() => open("onboard")}
                >
                  填写演示资料
                </Button>
              </Paper>
              <Paper variant="outlined" sx={panel}>
                <Typography variant="h6" mb={2}>
                  账户安全
                </Typography>
                <Alert severity="info">
                  真实登录、找回密码、二次验证和会话管理待接入客户认证接口。演示不收集密码或验证码。
                </Alert>
                <Button onClick={exit} sx={{ mt: 2 }}>
                  退出并清除演示数据
                </Button>
              </Paper>
            </>
          )}
          {!nav.some(([p]) => p === page) && (
            <Button component={Link} to="/portal/overview">
              返回工作台
            </Button>
          )}
        </Container>
      </Box>
      <Drawer
        anchor="right"
        open={Boolean(op)}
        onClose={() => setOp("")}
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 }, p: 3 } }}
      >
        <Stack direction="row" justifyContent="space-between" mb={3}>
          <Typography variant="h5">{titles[op]}</Typography>
          <IconButton aria-label="关闭表单" onClick={() => setOp("")}>
            ×
          </IconButton>
        </Stack>
        <Alert severity="info" sx={{ mb: 3 }}>
          仅演示，请勿填写真实资料。
          {op === "open" && "演示开卡免费，生成零余额模拟卡。"}
        </Alert>
        <Box key={op} component="form" onSubmit={submit}>
          <Stack gap={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {["open", "onboard"].includes(op) && (
              <TextField
                name="name"
                label={op === "onboard" ? "演示开户姓名" : "名称"}
                required
                inputProps={{ maxLength: 60 }}
              />
            )}
            {["topup", "return"].includes(op) && (
              <TextField
                name="card"
                label="选择卡片"
                select
                required
                defaultValue={
                  state.cards.find((c) => c.id === cardId && !c.frozen)?.id ||
                  state.cards.find((c) => !c.frozen)?.id ||
                  ""
                }
              >
                {state.cards
                  .filter(
                    (c) =>
                      !c.frozen &&
                      (page !== "cards" || !cardId || c.id === cardId),
                  )
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name} · {c.id.slice(-4)}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {op === "topup" && (
              <TextField
                select
                name="source"
                label="付款账户"
                defaultValue="main"
              >
                <MenuItem value="main">
                  主账户 USD · {money(state.balance)}
                </MenuItem>
              </TextField>
            )}
            {["topup", "return"].includes(op) && (
              <TextField
                name="amount"
                label="金额 · USD"
                required
                inputProps={{ inputMode: "decimal" }}
                helperText={
                  op === "topup"
                    ? "按所选付款账户检查余额 · 演示费用为 0"
                    : "仅可转回未冻结卡可用余额，模拟渠道成功后才进入账户；演示费用 0 USD"
                }
              />
            )}
            {op === "onboard" && (
              <TextField
                name="email"
                label="演示联系邮箱"
                type="email"
                required
              />
            )}
            {op === "ticket" && (
              <TextField
                name="description"
                label="问题描述"
                required
                multiline
                minRows={4}
                defaultValue={
                  detail
                    ? `交易 ${detail.id}：`
                    : page === "cards" && cardId
                      ? `卡片 ${cardId}：`
                      : new URLSearchParams(location.search).get("order")
                        ? `资金订单 ${new URLSearchParams(location.search).get("order")}：`
                        : ""
                }
                inputProps={{ minLength: 5, maxLength: 2000 }}
              />
            )}
            <Button variant="contained" type="submit">
              确认演示提交
            </Button>
            <Button onClick={() => setOp("")}>取消</Button>
          </Stack>
        </Box>
      </Drawer>
      <Drawer
        anchor="right"
        open={Boolean(detail) && !op}
        onClose={() => setDetail(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 }, p: 3 } }}
      >
        <Stack direction="row" justifyContent="space-between" mb={3}>
          <Typography variant="h5">交易详情</Typography>
          <IconButton aria-label="关闭详情" onClick={() => setDetail(null)}>
            ×
          </IconButton>
        </Stack>
        {detail && (
          <Stack gap={3}>
            <Badge status={detail.status} />
            <Typography variant="h4">
              {asset(detail.amount, detail.currency)}
            </Typography>
            {[
              ["编号", detail.id],
              ["名称", detail.name],
              ["类型", detail.kind],
              ["时间", detail.time],
              ["关联卡片", detail.card || "账户资金"],
            ].map(([k, v]) => (
              <Box key={k}>
                <Typography variant="caption" color="text.secondary">
                  {k}
                </Typography>
                <Typography>{v}</Typography>
              </Box>
            ))}
            {detail.status === "失败" && (
              <Alert severity="warning">
                演示原因：余额不足，请核对卡片余额。
              </Alert>
            )}
            <Button variant="outlined" onClick={() => open("ticket")}>
              对此交易有疑问
            </Button>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
