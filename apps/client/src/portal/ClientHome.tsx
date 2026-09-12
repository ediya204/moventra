import OnboardingPanel from "../../../../packages/shared/src/onboarding/OnboardingPanel";
import {clientFeaturesEnabled,onboardingMessage,type OnboardingState} from "../../../../packages/shared/src/auth/onboarding";
import { workspaceNavigation, workspaceWidth, workspaceGrid, workspaceChartsGrid } from "./workspaceNavigation";
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
  return `${row.direction === "debit" ? "−" : "+"}${row.scale ? digits.slice(0, -row.scale) + "." + digits.slice(-row.scale) : digits} ${row.currency}`;
}
export default function ClientHome() {
  const { user, session, sessionError, ready, signOut } = useAuth();
  const { pathname } = useLocation();
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
    if (!customer || !session || !user) return;
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
  }, [customer?.id, session, user, reload]);
  if (!ready || !session || sessionError || !user) return <SessionPage />;
  if (pathname === "/portal/overview") return <Navigate to="/portal" replace />;
  if (!links.some(([path]) => path === pathname || path === "/portal/cards" && pathname === "/portal/cards/new"))
    return <Navigate to="/portal" replace />;
  const data = snapshot?.customer === customer?.id ? snapshot : null;
  const error =
    failure && failure.customer === customer?.id ? failure.message : null;
  const admission=onboarding?.customerId===customer?.id?onboarding:null;
  const enabled=clientFeaturesEnabled(admission);
  const security = pathname === "/portal/security";
  const page = links.find(([path]) => path === pathname || path !== "/portal" && pathname.startsWith(path + "/"))?.[1] || "工作台";
  const nav = (
    <Stack sx={{ height: "100%", p: 2.5, overflowY: "auto" }} spacing={3}>
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
            selected={pathname === path || path !== "/portal" && pathname.startsWith(path + "/")}
            aria-current={pathname === path ? "page" : undefined}
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
        <Typography variant="subtitle2">你的 Moventra 账户</Typography>
        <Typography variant="caption" color="text.secondary">
          在账户与安全中管理登录和双重验证。
        </Typography>
      </Paper>
      <Button component={Link} to="/">
        返回官网
      </Button>
    </Stack>
  );
  const accounts = (
    <Paper variant="outlined" sx={{ p: 3 }}>
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
            账户开通后，将在这里显示。
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
    <Paper variant="outlined" sx={{ p: 3 }}>
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
          spacing={2}
          sx={{
            px: 3,
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
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            工作空间 / {page}
          </Typography>
          <Chip size="small" variant="outlined" label="正式账户" color="primary" />
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
        <Container maxWidth="xl" component="main" sx={{ py: 4 }}>
          {security ? (
            <>
              <Typography variant="h4">账户与安全</Typography>
              <SessionPage />
            </>
          ) : (
            <Stack spacing={3}>
              <Alert severity="info">{onboardingMessage(admission)} 账户权限与功能接入状态分别显示，未接入接口的功能暂不能办理。</Alert>
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
                    个人账户 · 管理投放资金与卡片预算
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  sx={{ alignSelf: "center" }}
                  onClick={() => setReload((n) => n + 1)}
                  disabled={!customer}
                  startIcon={<Icon icon="solar:refresh-linear" />}
                >
                  刷新数据
                </Button>
              </Stack>
              {error && <Alert severity="error">{error}</Alert>}
              {!customer && (
                <Alert severity="info">
                  当前尚未开通个人账户，请联系支持。
                </Alert>
              )}
              {pathname === "/portal" && (
                <>
                  <Paper variant="outlined" sx={{ display: "grid", gridTemplateColumns: workspaceGrid.gridTemplateColumns, overflow: "hidden" }}>
                    {["USD 可用余额", "USDT 可用余额", "内部卡预算 · USD", "使用中卡片"].map(label => (
                      <Box key={label} sx={{ p: 2.5, borderRight: 1, borderBottom: 1, borderColor: "divider" }}>
                        <Typography variant="body2" color="text.secondary">{label}</Typography>
                        <Typography variant="h4" sx={{ my: 1.5 }}>—</Typography>
                        <Typography variant="caption" color="text.secondary">余额 / 卡片数据接口尚未接入</Typography>
                      </Box>
                    ))}
                  </Paper>
                  <Box sx={workspaceGrid}>
                    {[["充值 USDT", "solar:wallet-money-linear"], ["兑换 USD", "solar:refresh-linear"], ["充值到卡", "solar:card-transfer-linear"], ["申请新卡", "solar:card-linear"]].map(([label, icon]) => (
                      <Paper key={label} variant="outlined" sx={{ p: 2 }}>
                        <Button component={Link} to={label === "申请新卡" ? "/portal/cards" : "/portal/funds"} disabled={!enabled} fullWidth startIcon={<Icon icon={icon} width={24} />}>{label}</Button>
                        <Typography variant="caption" color="text.secondary">{enabled ? "功能权限已开放 · 查看接入状态" : "待审批开通"}</Typography>
                      </Paper>
                    ))}
                  </Box>
                  <Box sx={workspaceChartsGrid}>
                    {[["消费与退款趋势", "solar:chart-2-linear", "暂未提供消费与退款统计"], ["卡片状态分布", "solar:pie-chart-2-linear", "暂未提供卡片统计"]].map(([title, icon, reason]) => (
                      <Paper key={title} variant="outlined" sx={{ p: 3 }}>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <Box sx={{ color: "primary.main" }}><Icon icon={icon} width={24} /></Box>
                          <Typography variant="h6">{title}</Typography>
                        </Stack>
                        <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 260 }}>
                          <Typography color="text.secondary">{reason}</Typography>
                          <Typography variant="caption" color="text.secondary">统计接口接入后显示真实数据</Typography>
                        </Stack>
                      </Paper>
                    ))}
                  </Box>
                </>
              )}
              {customer && <OnboardingPanel key={customer.id} customerId={customer.id} onState={setOnboarding}/> }
              {["/portal", "/portal/accounts", "/portal/funds"].includes(pathname) && accounts}
              {["/portal", "/portal/transactions"].includes(pathname) && transactions}
              {pathname === "/portal/settings" && <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography variant="h6">个人账户设置</Typography>
                <Typography color="text.secondary" sx={{ my: 2 }}>{user.email}</Typography>
                <Stack direction="row" spacing={2}>
                  <Button component={Link} to="/portal/accounts" variant="outlined">我的账户</Button>
                  <Button component={Link} to="/portal/security" variant="outlined">账户与安全</Button>
                </Stack>
              </Paper>}
              {["funds", "cards", "messages", "support", "settings"].some(route => pathname === `/portal/${route}` || pathname.startsWith(`/portal/${route}/`)) && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Typography variant="h6">{page}</Typography>
                  <Typography color="text.secondary" sx={{ my: 2 }}>{enabled ? `${page}功能权限已开放，办理接口尚未接入。` : `${page}办理权限待后台审批开通。`} 当前可查询已授权的账户与交易。</Typography>
                  <Button component={Link} to="/portal/transactions" variant="outlined">查看交易与账单</Button>
                </Paper>
              )}
            </Stack>
          )}
        </Container>
      </Box>
    </Box>
  );
}
