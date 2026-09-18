import MessageCenter, {MessageBell} from '../../../../packages/shared/src/messages/MessageCenter';
import FundsNavigation from '../../../../packages/shared/src/finance/FundsNavigation';
import SectionNavigation from '../../../../packages/shared/src/components/SectionNavigation';
import ManualFunds from '../../../../packages/shared/src/finance/ManualFunds';
import CardIssuing from "../issuing/CardIssuing";
import CustomerFunds from '../../../../packages/shared/src/finance/CustomerFunds';
import CardOverview from './CardOverview';
import ProductionWallet from './ProductionWallet';
import CardSnapshots from './CardSnapshots';
import OnboardingPanel from "../../../../packages/shared/src/onboarding/OnboardingPanel";
import {clientFeaturesEnabled,type OnboardingState} from "../../../../packages/shared/src/auth/onboarding";
import { workspaceNavigation, workspaceWidth, workspacePage } from "./workspaceNavigation";
import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Link, Navigate, useLocation } from "react-router-dom";
import { BrandLogo } from "../../../../packages/shared/src/components/BrandLogo";
import { useAuth } from "../../../../packages/shared/src/auth/AuthContext";
import { authMessage, liveGet } from "../../../../packages/shared/src/auth/liveApi";
import SessionPage from "../../../../packages/shared/src/auth/SessionPage";

type Account = { id: string; name: string; status: string };
type Transaction = {
  id: string;
  currency: string;
  amountMinor: string;
  scale: number;
  direction: string;
  status: string;
  occurredAt: string;
};
type Snapshot = {
  customer: string;
  accounts: Account[];
  transactions: Transaction[];
};
const links = [
  ...workspaceNavigation.map(([path, label, icon]) => [path === "overview" ? "/portal" : `/portal/${path}`, label, icon]),
  ["/portal/accounts", "我的账户", "solar:wallet-linear"],
  ["/portal/security", "账户与安全", "solar:shield-check-linear"],
];
const statusLabel: Record<string, string> = {
  active: "正常",
  inactive: "未激活",
  suspended: "已暂停",
  pending: "处理中",
  succeeded: "已完成",
  failed: "失败",
  closed: "已关闭",
};
function amount(row: Transaction) {
  const digits = row.amountMinor.padStart(row.scale + 1, "0");
  return `${row.direction === "debit" ? "−" : "+"}${row.scale ? digits.slice(0, -row.scale) + "." + (row.currency === "USDT" ? digits.slice(-row.scale).slice(0, 2).padEnd(2, "0") : digits.slice(-row.scale)) : digits} ${row.currency}`;
}
export default function ClientHome() {
  const { user, session, sessionError, ready, signOut } = useAuth();
  const { pathname, state: navigationState } = useLocation();
  const [onboarding,setOnboarding]=useState<OnboardingState|null>(null);
  const [mobile, setMobile] = useState(false);
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<{
    customer: string;
    message: string;
  } | null>(null);
  const customer = session?.customers.find((c) => c.kind === "personal");
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setFailure(null);
    if (!customer || !session || !user || pathname !== "/portal/accounts") return;
    const id = customer.id;
    Promise.all([
      liveGet<Account[]>(`/client-api/v1/customers/${id}/accounts`),
      liveGet<Transaction[]>(`/client-api/v1/customers/${id}/transactions`),
    ])
      .then(([accounts, transactions]) => {
        if (active) setSnapshot({ customer: id, accounts, transactions });
      })
      .catch((error) => {
        if (active) setFailure({ customer: id, message: authMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [customer?.id, session, user, reload, pathname]);
  if (!ready || !session || sessionError || !user) return <SessionPage />;
  if (pathname.startsWith("/portal/test-funds")) return <Navigate to="/portal/funds" replace />;
  if (pathname === "/portal/overview") return <Navigate to="/portal" replace />;
  if (!/^\/portal\/messages\/[0-9a-f-]{36}$/.test(pathname) && !/^\/portal\/funds\/manual(?:\/orders\/[0-9a-f-]{36})?$/.test(pathname) && !/^\/portal\/(?:card-orders(?:\/[0-9a-f-]{36})?|issued-cards\/[0-9a-f-]{36})$/.test(pathname) && !/^\/portal\/test-funds(?:\/(?:history|orders\/[0-9a-f-]{36}))?$/.test(pathname) && !/^\/portal\/crypto(?:\/(?:deposit|fiat|withdraw|exchange|history|orders\/[0-9a-f-]{36}))?$/.test(pathname) && !/^\/portal\/funds(?:\/(?:deposit|fiat|fiat-deposit|exchange|withdraw|history|orders\/[0-9a-f-]{36}))?$/.test(pathname) && !/^\/portal\/(cards|card-transactions)\/[A-Za-z0-9_-]+$/.test(pathname) && !links.some(([path]) => path === pathname || path === "/portal/cards" && pathname === "/portal/cards/new"))
    return <Navigate to="/portal" replace />;
  const data = snapshot?.customer === customer?.id ? snapshot : null;
  const error =
    failure && failure.customer === customer?.id ? failure.message : null;
  const admission=onboarding?.customerId===customer?.id?onboarding:null;
  const enabled=clientFeaturesEnabled(admission);
  const security = pathname === "/portal/security";
  const fallbackTitle = pathname.startsWith("/portal/card-orders/") ? "开卡订单详情" : pathname === "/portal/card-orders" ? "开卡订单" : pathname.startsWith("/portal/issued-cards/") ? "新开卡片详情" : pathname === "/portal/cards/new" ? "申请新卡" : pathname.startsWith("/portal/cards/") ? "卡片详情" : pathname.startsWith("/portal/card-transactions/") ? "卡片交易详情" : links.find(([path]) => path === pathname || path !== "/portal" && pathname.startsWith(path + "/"))?.[1] || "工作台";
  const { title: page, description, section } = workspacePage(pathname, fallbackTitle);
  const refreshPage = ["/portal", "/portal/accounts"].includes(pathname);
  const settingsPage = ["/portal/settings", "/portal/accounts", "/portal/security"].includes(pathname);
  const settingsNav = <SectionNavigation label="账户设置分区" active={pathname} items={[
    {value:"/portal/settings",label:"个人设置",to:"/portal/settings"},
    {value:"/portal/accounts",label:"我的账户",to:"/portal/accounts"},
    {value:"/portal/security",label:"账户与安全",to:"/portal/security"},
  ]}/>;
  const nav = (
    <Stack component="nav" aria-label="客户端主导航" sx={{ height: "100%", p: 2.5, overflowY: "auto" }} spacing={2.5}>
      <Box sx={{ py: 2 }}>
        <BrandLogo width={190} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        客户工作台 / CLIENT WORKSPACE
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">个人账户</Typography>
        <Typography variant="caption" color="text.secondary">正式账户 · 授权数据</Typography>
      </Paper>
      <List disablePadding>
        {links.slice(0, 7).map(([path, label, icon]) => (
          <ListItemButton
            key={path}
            component={Link}
            to={path}
            selected={section === path}
            aria-current={section === path ? "page" : undefined}
            onClick={() => setMobile(false)}
            sx={{
              mb: 0.75,
              borderRadius: 1.5,
              "&.Mui-selected": {
                color: "primary.main",
                bgcolor: "primary.lighter",
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon icon={icon} width={22} />
            </ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ variant: "body2" }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">账户帮助</Typography>
        <Typography variant="caption" color="text.secondary">
          <Button component={Link} to="/portal/security" size="small" onClick={()=>setMobile(false)}>管理登录与双重验证</Button>
        </Typography>
      </Paper>
      <Button component={Link} to="/">
        返回官网
      </Button>
    </Stack>
  );
  const accounts = (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="h6">我的账户</Typography>
        <Typography variant="caption" color="text.secondary">
          最多显示前 50 条
        </Typography>
      </Stack>
      {!data ? (
        <Typography color="text.secondary">
          {error
            ? "账户数据暂不可用"
            : customer
              ? "正在读取账户…"
              : "关联个人账户后可查看账户。"}
        </Typography>
      ) : !data.accounts.length ? (
        <Stack spacing={1} sx={{ py: 5, textAlign: "center" }}>
          <Typography variant="subtitle1">暂无业务账户</Typography>
          <Typography variant="body2" color="text.secondary">
            当前没有业务账户记录；开户审核状态以上方“开户与功能权限”为准。
          </Typography>
        </Stack>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>账户名称</TableCell>
                <TableCell>状态</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{statusLabel[a.status] || a.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
  const transactions = (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6">最近交易</Typography>
        <Typography variant="caption" color="text.secondary">
          最近 50 条
        </Typography>
      </Stack>
      {!data ? (
        <Typography color="text.secondary">
          {error
            ? "交易数据暂不可用"
            : customer
              ? "正在读取交易…"
              : "关联个人账户后可查看交易。"}
        </Typography>
      ) : !data.transactions.length ? (
        <Stack spacing={1} sx={{ py: 5, textAlign: "center" }}>
          <Typography variant="subtitle1">暂无交易记录</Typography>
          <Typography variant="body2" color="text.secondary">
            发生交易后，你可以在这里查看明细与处理状态。
          </Typography>
        </Stack>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>时间</TableCell>
                <TableCell>金额</TableCell>
                <TableCell>状态</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.transactions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {new Date(row.occurredAt).toLocaleString("zh-CN")}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {amount(row)}
                  </TableCell>
                  <TableCell>{statusLabel[row.status] || row.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
      }}
    >
      <Button component="a" href="#workspace-content" sx={{position:'fixed',top:8,left:8,zIndex:1400,transform:'translateY(-160%)',bgcolor:'background.paper','&:focus':{transform:'none'}}}>跳到主要内容</Button>
      <Box
        component="aside"
        sx={{
          width: workspaceWidth,
          flexShrink: 0,
          display: { xs: "none", lg: "block" },
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          position: "fixed",
          inset: "0 auto 0 0",
        }}
      >
        {nav}
      </Box>
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        PaperProps={{ sx: { width: 270 } }}
      >
        {nav}
      </Drawer>
      <Box sx={{ flex: 1, ml: { lg: `${workspaceWidth}px` }, minWidth: 0 }}>
        <Stack
          component="header"
          direction="row"
          alignItems="center"
          spacing={{xs:1,sm:2}}
          sx={{
            px: { xs: 2, md: 3 },
            minHeight: 64,
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
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
            {page}
          </Typography>
          <Chip size="small" variant="outlined" label="正式账户" color="primary" sx={{display:{xs:"none",sm:"inline-flex"}}} />
          {customer && <MessageBell key={`bell:${customer.id}:${user.uid}`} customerId={customer.id}/> }
          <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
            {user.email?.[0].toUpperCase()}
          </Avatar>
          <Typography
            variant="body2"
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            {user.email}
          </Typography>
          <Button onClick={signOut}>退出</Button>
        </Stack>
        <Container maxWidth="xl" component="main" id="workspace-content" tabIndex={-1} sx={{ py: {xs:3,md:4}, px:{xs:2,sm:3,lg:4}, "& .MuiTableContainer-root":{maxWidth:"100%"} }}>
          {security ? (
            <Stack spacing={3}>
              <Box><Typography variant="h4" component="h1">账户与安全</Typography><Typography color="text.secondary" sx={{mt:.75}}>{description}</Typography></Box>
              {settingsNav}
              <SessionPage embedded />
            </Stack>
          ) : (
            <Stack spacing={3}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h4" component="h1">
                    {page}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    {description}
                  </Typography>
                </Box>
                {refreshPage && <Button
                  variant="outlined"
                  sx={{ alignSelf: {xs:"flex-start",sm:"center"}, flexShrink:0 }}
                  onClick={() => setReload((n) => n + 1)}
                  disabled={!customer}
                  startIcon={<Icon icon="solar:refresh-linear" />}
                >
                  刷新数据
                </Button>}
              </Stack>
              {settingsPage && settingsNav}
              {customer && <OnboardingPanel key={`onboarding:${customer.id}`} customerId={customer.id} onState={setOnboarding} compact refreshKey={reload}/> }
              {error && <Alert severity="error">{error}</Alert>}
              {!customer && (
                <Alert severity="info">
                  当前登录身份尚未关联个人客户主体，请联系支持。
                </Alert>
              )}
              {pathname === "/portal" && (
                <>
                  <Stack component="nav" aria-label="常用操作" direction="row" flexWrap="wrap" gap={1} sx={{pb:1}}>
                    {[["充值 USDT", "solar:wallet-money-linear"], ["兑换 USD", "solar:refresh-linear"], ["申请新卡", "solar:card-linear"]].map(([label, icon],i) => (
                      <Button key={label} component={Link} to={label === "申请新卡" ? "/portal/cards/new" : label === "充值 USDT" ? "/portal/funds/deposit" : label === "兑换 USD" ? "/portal/funds/exchange" : "/portal/funds/fiat"} variant={i===0?'contained':'outlined'} disabled={!enabled} sx={{minHeight:44,px:2,flex:{xs:'1 1 calc(50% - 8px)',sm:'0 0 auto'},boxShadow:'none'}} startIcon={<Icon icon={icon} width={20} />}>{label}</Button>
                    ))}
                  </Stack>
                  {customer&&<ProductionWallet key={`wallet:${customer.id}`} customerId={customer.id} reload={reload}>
                    <CardOverview key={`overview:${customer.id}`} customerId={customer.id} reload={reload}/>
                  </ProductionWallet>}
                </>
              )}
              {pathname === "/portal/accounts" && accounts}
              {pathname === "/portal/accounts" && transactions}
              {pathname === "/portal/settings" && <Paper variant="outlined" sx={{p:{xs:2,md:3}}}>
                <Stack spacing={2}><Box><Typography variant="h6">个人账户</Typography><Typography variant="body2" color="text.secondary" sx={{mt:.5,overflowWrap:'anywhere'}}>{user.email}</Typography></Box>
                <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2}}>
                  {[["我的账户","查询已关联的业务账户与账户记录","/portal/accounts","solar:wallet-linear"],["账户与安全","管理邮箱验证、登录和验证器","/portal/security","solar:shield-check-linear"]].map(([title,hint,to,icon])=><Box key={to} sx={{p:2,border:1,borderColor:'divider',borderRadius:1.5}}><Stack direction="row" alignItems="center" gap={1}><Icon icon={icon} width={22}/><Button component={Link} to={to}>{title}</Button></Stack><Typography variant="body2" color="text.secondary" sx={{mt:1}}>{hint}</Typography></Box>)}
                </Box>
                <Typography variant="body2" color="text.secondary">服务状态：{!customer?'尚未关联个人账户':!admission?'正在读取…':enabled?'账户已开通':admission.serviceStatus==='suspended'?'服务已暂停，请联系支持':'开户处理中，请查看上方提示'}</Typography></Stack>
              </Paper>}
              {customer && (pathname === "/portal/transactions" || pathname === "/portal/cards" || /^\/portal\/(cards|card-transactions)\/[A-Za-z0-9_-]+$/.test(pathname) && pathname !== "/portal/cards/new") && <CardSnapshots key={`cards:${customer.id}`} customerId={customer.id}/> }
              {pathname.startsWith('/portal/crypto')&&customer&&<CustomerFunds key={customer.id} customerId={customer.id} basePath="/portal/crypto" orderId={pathname.split('/orders/')[1]}/>}
              {customer && (pathname === "/portal/cards" || pathname === "/portal/cards/new" || pathname.startsWith("/portal/card-orders") || pathname.startsWith("/portal/issued-cards/")) && <CardIssuing key={`issuing:${customer.id}`} customerId={customer.id} uid={user.uid}/> }
              {pathname.startsWith('/portal/funds/manual')&&<FundsNavigation basePath="/portal/funds" section="manual"/>}
              {pathname.startsWith('/portal/funds/manual')&&customer&&<ManualFunds key={customer.id+pathname} customerId={customer.id} basePath="/portal/funds/manual" orderId={pathname.split('/orders/')[1]}/>}
              {pathname.startsWith('/portal/funds/orders/') && typeof navigationState?.messageReturn==='string' && /^\/portal\/messages\/[0-9a-f-]{36}(?:\?.*)?$/.test(navigationState.messageReturn) && <Button component={Link} to={navigationState.messageReturn} sx={{alignSelf:'flex-start'}}>返回消息详情</Button>}
              {pathname.startsWith("/portal/funds") && !pathname.startsWith('/portal/funds/manual') && customer && <CustomerFunds key={customer.id} customerId={customer.id} basePath="/portal/funds" orderId={pathname.split('/orders/')[1]}/> }

              {pathname.startsWith('/portal/messages') && customer && <MessageCenter key={`messages:${customer.id}:${user.uid}`} customerId={customer.id}/>}
              {pathname === "/portal/support" && <Stack spacing={3}>
                <Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Typography variant="h6" sx={{mb:2}}>常见问题</Typography>
                  {[["充值后在哪里查看到账进度？","在充值记录中查看链上核验与入账状态；只有已入账金额才计入可用余额。","查看充值记录","/portal/funds/deposit"],["如何查询卡片消费和退款？","交易与账单展示当前已授权卡片的交易，点击详情可查看原币金额和处理状态。","查看交易与账单","/portal/transactions"],["如何查看开卡申请的结果？","开卡订单保留申请和处理结果；结果待确认时请先查询原单，避免重复申请。","查看开卡订单","/portal/card-orders"],["如何保护账户登录？","在账户与安全中检查邮箱验证，并绑定验证器完成双重验证。","管理账户安全","/portal/security"]].map(([title,body,label,to])=><Box key={to} component="details" sx={{py:2,borderTop:1,borderColor:'divider'}}><Typography component="summary" variant="subtitle2" sx={{cursor:'pointer',minHeight:32}}>{title}</Typography><Typography variant="body2" color="text.secondary" sx={{mt:1,mb:1}}>{body}</Typography><Button component={Link} to={to}>{label}</Button></Box>)}
                </Paper>
                <Alert severity="info">在线工单尚未开放。需要人工协助时，请通过已有的服务联系渠道提供订单编号和问题描述。</Alert>
              </Stack>}

            </Stack>
          )}
        </Container>
      </Box>
    </Box>
  );
}
