import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { asset, type State } from "./model";
import { DashboardCharts } from "./DashboardCharts";

const grid = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" },
  gap: 3,
};
const pending = (status: string) =>
  !["已完成", "失败", "已取消", "已拒绝"].includes(status);

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card sx={{ minWidth: 0 }}>
      <CardHeader
        title={title}
        subheader={subtitle}
        titleTypographyProps={{ variant: "h6" }}
        subheaderTypographyProps={{ variant: "body2" }}
        action={action}
        sx={{
          p: { xs: 2, md: 3 },
          "& .MuiCardHeader-action": { alignSelf: "center", m: 0 },
        }}
      />
      <Divider />
      {children}
    </Card>
  );
}

function Shortcut({
  title,
  description,
  icon,
  to,
  onClick,
}: {
  title: string;
  description: string;
  icon: string;
  to?: string;
  onClick?: () => void;
}) {
  const content = (
    <CardContent
      sx={{
        display: "flex",
        gap: 1.5,
        alignItems: "center",
        p: 2,
        "&:last-child": { pb: 2 },
      }}
    >
      <Box sx={{ color: "primary.main", display: "flex", flexShrink: 0 }}>
        <Icon icon={icon} width={24} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
      <Box sx={{ color: "text.disabled", display: "flex" }}>
        <Icon icon="solar:alt-arrow-right-linear" width={18} />
      </Box>
    </CardContent>
  );
  return (
    <Card sx={{ minWidth: 0 }}>
      {to ? (
        <CardActionArea component={Link} to={to}>
          {content}
        </CardActionArea>
      ) : (
        <CardActionArea onClick={onClick}>{content}</CardActionArea>
      )}
    </Card>
  );
}

export function OverviewDashboard({
  state,
  onOperation,
  transactions,
}: {
  state: State;
  onOperation: (op: string) => void;
  transactions: ReactNode;
}) {
  const cardBalance = state.cards.reduce((sum, card) => sum + card.balance, 0);
  const attention = state.cards.filter(
    (card) => card.balance < 20000 || card.frozen,
  );
  const orders = state.finance.orders.filter((order) => pending(order.status));
  const activeCards = state.cards.filter((card) => !card.frozen).length;
  const stats = [
    {
      label: "USD 可用余额",
      value: asset(state.balance).replace(" USD", ""),
      helper: "用于个人卡片充值与资金管理",
      to: "/portal/funds",
    },
    {
      label: "USDT 可用余额",
      value: asset(state.finance.usdt, "USDT").replace(" USDT", ""),
      helper: "充值、兑换与提现",
      to: "/portal/funds",
    },
    {
      label: "内部卡预算 · USD",
      value: asset(cardBalance).replace(" USD", ""),
      helper: "包含冻结卡片的余额",
      to: "/portal/cards",
    },
    {
      label: "使用中卡片",
      value: `${activeCards} / ${state.cards.length}`,
      helper: `${state.cards.length - activeCards} 张冻结`,
      to: "/portal/cards",
    },
  ];
  return (
    <Stack gap={3}>
      <Card>
        <Box
          sx={{
            display: "grid",
            gap: "1px",
            bgcolor: "divider",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              lg: "repeat(4, minmax(0, 1fr))",
            },
          }}
        >
          {stats.map((stat) => (
            <CardActionArea
              component={Link}
              to={stat.to}
              key={stat.label}
              sx={{ p: 2.5, bgcolor: "background.paper" }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="body2" color="text.secondary">
                  {stat.label}
                </Typography>
                <Box color="primary.main" display="flex">
                  <Icon icon="solar:arrow-right-up-linear" width={18} />
                </Box>
              </Stack>
              <Typography
                variant="h5"
                sx={{ my: 1.5, overflowWrap: "anywhere" }}
              >
                {stat.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stat.helper}
              </Typography>
            </CardActionArea>
          ))}
        </Box>
      </Card>
      <Box
        component="section"
        aria-label="常用操作"
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            lg: "repeat(4, minmax(0, 1fr))",
          },
          gap: 2,
        }}
      >
        <Shortcut
          title="充值 USDT"
          description="补充账户资金"
          icon="solar:wallet-money-linear"
          to="/portal/funds/deposit"
        />
        <Shortcut
          title="兑换 USD"
          description="准备卡片充值资金"
          icon="solar:refresh-linear"
          to="/portal/funds/exchange"
        />
        <Shortcut
          title="充值到卡"
          description="为投放卡片补充预算"
          icon="solar:card-transfer-linear"
          onClick={() => onOperation("topup")}
        />
        <Shortcut
          title="申请新卡"
          description="为新的投放项目开卡"
          icon="solar:card-linear"
          onClick={() => onOperation("open")}
        />
      </Box>
      <DashboardCharts state={state} />
      <Box sx={grid}>
        <Section
          title="需要关注"
          subtitle="卡片状态与处理中资金订单"
          action={
            <Chip
              size="small"
              label={`${attention.length + orders.length} 项`}
              color={attention.length + orders.length ? "warning" : "default"}
              variant="outlined"
            />
          }
        >
          <List disablePadding>
            {attention.map((card) => (
              <ListItem key={card.id} disablePadding divider>
                <ListItemButton
                  component={Link}
                  to={`/portal/cards/${card.id}`}
                  sx={{
                    px: 3,
                    py: 2,
                    borderRadius: 0,
                    alignItems: "flex-start",
                  }}
                >
                  <ListItemIcon
                    sx={{
                      pt: 0.5,
                      color: card.frozen ? "error.main" : "warning.dark",
                    }}
                  >
                    <Icon
                      icon={
                        card.frozen
                          ? "solar:lock-keyhole-linear"
                          : "solar:wallet-linear"
                      }
                      width={22}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={card.name}
                    secondary={
                      card.frozen
                        ? "卡片已冻结，查看详情了解处理方式"
                        : `可用 ${asset(card.balance)}，可前往补充预算`
                    }
                    primaryTypographyProps={{
                      variant: "subtitle2",
                      color: "text.primary",
                    }}
                    secondaryTypographyProps={{
                      variant: "body2",
                      sx: { mt: 0.5 },
                    }}
                  />
                  <Chip
                    size="small"
                    label={card.frozen ? "已冻结" : "低余额"}
                    variant="outlined"
                    color={card.frozen ? "error" : "warning"}
                    sx={{ ml: 1, mt: 0.5 }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {orders.slice(0, 3).map((order) => (
              <ListItemButton
                key={order.id}
                component={Link}
                to={`/portal/funds/orders/${order.id}`}
                sx={{ px: 3, py: 2, borderRadius: 0 }}
              >
                <ListItemIcon>
                  <Icon icon="solar:clock-circle-linear" width={22} />
                </ListItemIcon>
                <ListItemText
                  primary={`${order.kind} · ${asset(order.amount, order.currency)}`}
                  secondary={order.id}
                  primaryTypographyProps={{
                    variant: "subtitle2",
                    color: "text.primary",
                  }}
                />
                <Chip size="small" label={order.status} variant="outlined" />
              </ListItemButton>
            ))}
          </List>
          {!attention.length && !orders.length && (
            <Box p={3}>
              <Alert severity="success">
                当前没有需要关注的卡片或资金订单。
              </Alert>
            </Box>
          )}
          {orders.length > 3 && (
            <Button component={Link} to="/portal/funds/history" sx={{ m: 2 }}>
              查看全部 {orders.length} 笔处理中订单
            </Button>
          )}
        </Section>
        <Section
          title="卡片预算分布"
          subtitle="展示预算最高的 5 张卡，不代表消费占比"
          action={
            <Button component={Link} to="/portal/cards" size="small">
              全部卡片
            </Button>
          }
        >
          <Stack gap={2.5} sx={{ p: 3 }}>
            {[...state.cards].sort((a,b)=>b.balance-a.balance).slice(0,5).map((card) => {
              const balance = card.balance;
              const percent = cardBalance ? (balance / cardBalance) * 100 : 0;
              return (
                <Box key={card.id}>
                  <Stack
                    direction="row"
                    gap={1}
                    justifyContent="space-between"
                    mb={1}
                  >
                    <Typography variant="body2">{card.name}</Typography>
                    <Typography variant="subtitle2">
                      {asset(balance)}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={percent}
                    aria-label={`${card.name}内部卡预算占比`}
                    sx={{
                      height: 6,
                      borderRadius: 1,
                      bgcolor: "primary.lighter",
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    占内部卡预算 {percent.toFixed(1)}%
                  </Typography>
                </Box>
              );
            })}
            {!state.cards.length && (
              <Typography color="text.secondary">
                开卡后可查看各卡片预算分布。
              </Typography>
            )}
          </Stack>
        </Section>
      </Box>
      <Section
        title="最近交易"
        subtitle="本次演示中的最近 5 条记录"
        action={
          <Button component={Link} to="/portal/transactions" size="small">
            查看全部
          </Button>
        }
      >
        {transactions}
      </Section>
    </Stack>
  );
}

export function FundsDashboard({
  state,
  recentOrders,
}: {
  state: State;
  recentOrders: ReactNode;
}) {
  const f = state.finance;
  const orders = f.orders.filter((order) => pending(order.status));
  const awaitingDeposit = orders
    .filter((order) => order.kind === "充值")
    .reduce((sum, order) => sum + order.amount, 0);
  const cardReturns = orders
    .filter((order) => order.kind === "卡片转回")
    .reduce((sum, order) => sum + order.amount, 0);
  const positions = [
    {
      title: "内部卡预算",
      value: state.cards.reduce((sum, card) => sum + card.balance, 0),
      note: "包含冻结卡片中的资金",
      to: "/portal/cards",
      icon: "solar:card-linear",
    },
  ];
  return (
    <Stack gap={3}>
      {!!state.finance.legacyRestrictedUsd && <Alert severity="info">历史隔离余额 {asset(state.finance.legacyRestrictedUsd)} 已保留，不计入个人可用资金。如需处理请联系支持。</Alert>}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            lg: "repeat(3, minmax(0, 1fr))",
          },
          gap: 2,
        }}
        component="section"
        aria-label="资金操作"
      >
        <Shortcut
          title="充值"
          description="USDT 充值到账户"
          icon="solar:wallet-money-linear"
          to="/portal/funds/deposit"
        />
        <Shortcut
          title="兑换"
          description="USDT 与 USD 互换"
          icon="solar:refresh-linear"
          to="/portal/funds/exchange"
        />
        <Shortcut
          title="提现"
          description="提取到已添加的地址"
          icon="solar:arrow-right-up-linear"
          to="/portal/funds/withdraw"
        />
      </Box>
      <Section
        title="账户资产"
        subtitle="可用余额可用于操作；冻结 / 预占资金单独列示"
        action={
          <Button component={Link} to="/portal/funds/history" size="small">
            资金流水
          </Button>
        }
      >
        <List
          disablePadding
          aria-label="资金账户资产"
          sx={{ display: { xs: "block", md: "none" } }}
        >
          {(["USD", "USDT"] as const).map((currency) => (
            <ListItem key={currency} divider sx={{ display: "block", p: 2.5 }}>
              <Stack direction="row" justifyContent="space-between" mb={1.5}>
                <Typography variant="subtitle2">{currency} 资金账户</Typography>
                <Typography variant="caption" color="text.secondary">
                  可用余额
                </Typography>
              </Stack>
              <Typography variant="h5" sx={{ overflowWrap: "anywhere" }}>
                {asset(currency === "USD" ? state.balance : f.usdt, currency)}
              </Typography>
              <Stack
                direction="row"
                justifyContent="space-between"
                mt={1.5}
                gap={1}
              >
                <Typography variant="body2" color="text.secondary">
                  冻结 / 预占
                </Typography>
                <Typography variant="body2">
                  {asset(currency === "USD" ? f.heldUsd : f.heldUsdt, currency)}
                </Typography>
              </Stack>
              <Stack direction="row" gap={1} mt={2}>
                <Button
                  fullWidth
                  variant="outlined"
                  component={Link}
                  to={`/portal/funds/${currency === "USD" ? "exchange" : "deposit"}`}
                >
                  {currency === "USD" ? "兑换" : "充值"}
                </Button>
                <Button
                  fullWidth
                  component={Link}
                  to={currency === "USD" ? "/portal/cards" : "/portal/funds/withdraw"}
                >
                  {currency === "USD" ? "充值到卡" : "提现"}
                </Button>
              </Stack>
            </ListItem>
          ))}
        </List>
        <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
          <Table aria-label="资金账户资产" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow>
                <TableCell>资产账户</TableCell>
                <TableCell align="right">可用余额</TableCell>
                <TableCell align="right">冻结 / 预占</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(["USD", "USDT"] as const).map((currency) => (
                <TableRow key={currency} hover>
                  <TableCell>
                    <Stack direction="row" gap={1.5} alignItems="center">
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          bgcolor: "primary.lighter",
                          color: "primary.dark",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        <Icon
                          icon={
                            currency === "USD"
                              ? "solar:dollar-linear"
                              : "solar:wallet-money-linear"
                          }
                          width={22}
                        />
                      </Box>
                      <Box>
                        <Typography variant="subtitle2">
                          {currency} 资金账户
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {currency === "USD"
                            ? "卡片充值与个人资金"
                            : "数字资产充值与提现"}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
                      {asset(
                        currency === "USD" ? state.balance : f.usdt,
                        currency,
                      )}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {asset(
                      currency === "USD" ? f.heldUsd : f.heldUsdt,
                      currency,
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={Link}
                      to={`/portal/funds/${currency === "USD" ? "exchange" : "deposit"}`}
                    >
                      {currency === "USD" ? "兑换" : "充值"}
                    </Button>
                    <Button
                      component={Link}
                      to={currency === "USD" ? "/portal/cards" : "/portal/funds/withdraw"}
                    >
                      {currency === "USD" ? "充值到卡" : "提现"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ px: 3, py: 1.5, bgcolor: "grey.100" }}>
          <Typography variant="caption" color="text.secondary">
            USD 与 USDT 分币种列示，不按 1:1
            汇总。充值待入账金额不计入可用资产。
          </Typography>
        </Box>
      </Section>
      <DashboardCharts state={state} funds />
      <Box sx={grid}>
        <Section title="其他资金位置" subtitle="账户以外的 USD 资金，分别核算">
          <List disablePadding>
            {positions.map((position) => (
              <ListItem key={position.title} disablePadding divider>
                <ListItemButton
                  component={Link}
                  to={position.to}
                  sx={{
                    px: 3,
                    py: 2.5,
                    borderRadius: 0,
                    flexWrap: "wrap",
                    gap: 1,
                  }}
                >
                  <ListItemIcon>
                    <Icon icon={position.icon} width={24} />
                  </ListItemIcon>
                  <ListItemText
                    primary={position.title}
                    secondary={position.note}
                    primaryTypographyProps={{
                      variant: "subtitle2",
                      color: "text.primary",
                    }}
                  />
                  <Typography variant="h6" color="text.primary">
                    {asset(position.value)}
                  </Typography>
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Stack
            direction="row"
            justifyContent="space-between"
            gap={2}
            sx={{ p: 3 }}
          >
            <Box>
              <Typography variant="subtitle2">卡片转回处理中</Typography>
              <Typography variant="caption" color="text.secondary">
                完成后才增加账户可用余额
              </Typography>
            </Box>
            <Typography variant="subtitle2" sx={{ whiteSpace: "nowrap" }}>
              {asset(cardReturns)}
            </Typography>
          </Stack>
        </Section>
        <Section
          title="资金处理状态"
          action={
            <Chip
              size="small"
              label={`${orders.length} 笔处理中`}
              variant="outlined"
              color={orders.length ? "warning" : "default"}
            />
          }
        >
          <Stack gap={2} p={3}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                充值待入账
              </Typography>
              <Typography variant="h5" mt={0.75}>
                {asset(awaitingDeposit, "USDT")}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {orders.length
                ? "订单状态以处理结果为准，可进入流水查看进度与详情。"
                : "当前没有处理中订单。充值、提现和兑换的进度会显示在资金流水中。"}
            </Typography>
            <Button
              component={Link}
              to="/portal/funds/history"
              variant="outlined"
            >
              查看资金订单
            </Button>
            <Button
              component={Link}
              to="/portal/funds/addresses"
              startIcon={<Icon icon="solar:map-point-linear" width={18} />}
            >
              管理收款地址 · {f.addresses.length} 个
            </Button>
          </Stack>
        </Section>
      </Box>
      <Section
        title="最近资金订单"
        subtitle="追踪充值、兑换、提现和内部划拨"
        action={
          <Button component={Link} to="/portal/funds/history" size="small">
            全部订单
          </Button>
        }
      >
        {f.orders.length ? (
          recentOrders
        ) : (
          <Stack
            alignItems="center"
            textAlign="center"
            gap={1.5}
            sx={{ px: 3, py: 5 }}
          >
            <Box color="text.secondary">
              <Icon icon="solar:bill-list-linear" width={36} />
            </Box>
            <Typography variant="subtitle1">还没有资金订单</Typography>
            <Typography variant="body2" color="text.secondary">
              发起充值后，可在这里查看确认进度、到账结果与费用。
            </Typography>
            <Button
              component={Link}
              to="/portal/funds/deposit"
              variant="outlined"
            >
              发起 USDT 充值
            </Button>
          </Stack>
        )}
      </Section>
    </Stack>
  );
}
