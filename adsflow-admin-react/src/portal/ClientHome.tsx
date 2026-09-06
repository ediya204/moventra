import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Skeleton,
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
import { Link, Navigate, useLocation } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { useAuth } from "../auth/AuthContext";
import { authMessage, liveGet } from "../auth/liveApi";
import SessionPage from "../auth/SessionPage";

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
  ["/portal", "首页", "solar:widget-4-linear"],
  ["/portal/accounts", "我的账户", "solar:wallet-linear"],
  ["/portal/transactions", "交易记录", "solar:transfer-horizontal-linear"],
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
  const [mobile, setMobile] = useState(false);
  const [selected, setSelected] = useState("");
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<{
    customer: string;
    message: string;
  } | null>(null);
  const customer =
    session?.customers.find((c) => c.id === selected) ||
    session?.customers.find((c) => c.kind === "personal") ||
    session?.customers[0];
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
  if (!links.some(([path]) => path === pathname))
    return <Navigate to="/portal" replace />;
  const data = snapshot?.customer === customer?.id ? snapshot : null;
  const error =
    failure && failure.customer === customer?.id ? failure.message : null;
  const security = pathname === "/portal/security";
  const page = links.find(([path]) => path === pathname)?.[1] || "首页";
  const nav = (
    <Stack sx={{ height: "100%", p: 2.5 }} spacing={3}>
      <Box sx={{ py: 1 }}>
        <BrandLogo />
      </Box>
      <Typography variant="overline" color="text.secondary">
        客户端工作台
      </Typography>
      <List disablePadding>
        {links.map(([path, label, icon]) => (
          <ListItemButton
            key={path}
            component={Link}
            to={path}
            selected={pathname === path}
            onClick={() => setMobile(false)}
            sx={{
              mb: 0.75,
              borderRadius: 1.5,
              "&.Mui-selected": {
                color: "primary.main",
                bgcolor: "action.selected",
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon icon={icon} width={22} />
            </ListItemIcon>
            <ListItemText primary={label} />
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
              : "关联客户主体后可查看账户。"}
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
              : "关联客户主体后可查看交易。"}
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
          width: 248,
          flexShrink: 0,
          display: { xs: "none", md: "block" },
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
      <Box sx={{ flex: 1, ml: { md: "248px" }, minWidth: 0 }}>
        <Stack
          component="header"
          direction="row"
          alignItems="center"
          spacing={2}
          sx={{
            px: { xs: 2, md: 5 },
            height: 80,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <IconButton
            aria-label="打开导航"
            onClick={() => setMobile(true)}
            sx={{ display: { md: "none" } }}
          >
            <Icon icon="solar:hamburger-menu-linear" />
          </IconButton>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Moventra 客户端
          </Typography>
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
        <Container maxWidth="lg" component="main" sx={{ py: { xs: 3, md: 5 } }}>
          {security ? (
            <>
              <Typography variant="h4">账户与安全</Typography>
              <SessionPage />
            </>
          ) : (
            <Stack spacing={3}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h4" component="h1">
                    {pathname === "/portal" ? "欢迎回来" : page}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    查看你的账户与交易，管理日常业务。
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  onClick={() => setReload((n) => n + 1)}
                  disabled={!customer}
                  startIcon={<Icon icon="solar:refresh-linear" />}
                >
                  刷新数据
                </Button>
              </Stack>
              {customer && (
                <TextField
                  select
                  label="当前个人 / 企业主体"
                  size="small"
                  value={customer.id}
                  onChange={(e) => setSelected(e.target.value)}
                  sx={{ maxWidth: 400 }}
                >
                  {session.customers.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {error && <Alert severity="error">{error}</Alert>}
              {!customer && (
                <Alert severity="info">
                  当前尚未关联个人或企业主体，请联系账户管理员。
                </Alert>
              )}
              {pathname === "/portal" && (
                <>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" },
                      gap: 2,
                    }}
                  >
                    {[
                      [
                        "我的账户",
                        data?.accounts.length,
                        "已读取账户 · 最多 50 条",
                      ],
                      [
                        "最近交易",
                        data?.transactions.length,
                        "已读取交易 · 最多 50 条",
                      ],
                      [
                        "账户安全",
                        session.mfaVerified ? "已验证" : "已登录",
                        session.mfaVerified
                          ? "本次登录已完成双重验证"
                          : "可在账户与安全中设置验证器",
                      ],
                    ].map(([label, value, caption]) => (
                      <Paper
                        key={String(label)}
                        variant="outlined"
                        sx={{ p: 3 }}
                      >
                        <Typography color="text.secondary" variant="body2">
                          {label}
                        </Typography>
                        <Typography variant="h4" sx={{ my: 1.5 }}>
                          {value ??
                            (error || !customer ? (
                              "—"
                            ) : (
                              <Skeleton width={60} />
                            ))}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {caption}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                  <Paper variant="outlined" sx={{ p: 3 }}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={2}
                      alignItems={{ sm: "center" }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6">开始使用你的账户</Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          查看账户信息与交易记录。开卡、充值等服务开放后，将在这里提供入口。
                        </Typography>
                      </Box>
                      <Button
                        component={Link}
                        to="/portal/accounts"
                        variant="contained"
                      >
                        查看账户
                      </Button>
                    </Stack>
                  </Paper>
                </>
              )}
              {pathname !== "/portal/transactions" && accounts}
              {pathname !== "/portal/accounts" && transactions}
            </Stack>
          )}
        </Container>
      </Box>
    </Box>
  );
}
