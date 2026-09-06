import { lazy, Suspense, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Icon } from "@iconify/react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardHeader,
  Chip,
  Collapse,
  Divider,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import { asset, type Currency, type State } from "./model";
import { assetComposition, cardComposition, spendingTrend } from "./chartData";
const Chart = lazy(() => import("react-apexcharts"));
const number = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function DashboardCharts({
  state,
  funds = false,
}: {
  state: State;
  funds?: boolean;
}) {
  const theme = useTheme();
  const [days, setDays] = useState<7 | 30>(7);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [details, setDetails] = useState(false);
  const rows = state.analytics?.[days] || spendingTrend(state.entries, days);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const refund = rows.reduce((sum, row) => sum + row.refund, 0);
  const composition = funds
    ? assetComposition(state, currency)
    : cardComposition(state);
  const total = composition.reduce((sum, item) => sum + item.value, 0);
  const colors = funds
    ? [
        theme.palette.primary.main,
        theme.palette.primary.light,
        theme.palette.secondary.main,
        theme.palette.warning.main,
        theme.palette.info.dark,
      ]
    : [
        theme.palette.primary.main,
        theme.palette.warning.main,
        theme.palette.error.main,
      ];
  const common: ApexOptions = {
    chart: {
      fontFamily: theme.typography.fontFamily,
      foreColor: theme.palette.text.secondary,
      toolbar: { show: false },
      animations: { enabled: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
    },
    theme: { mode: "light" },
    dataLabels: { enabled: false },
    tooltip: { theme: "light" },
  };
  const trendOptions: ApexOptions = {
    ...common,
    colors: [theme.palette.primary.main, theme.palette.success.dark],
    stroke: { curve: "straight", width: [3, 2], dashArray: [0, 5] },
    fill: { type: "solid", opacity: [0.08, 0.03] },
    markers: {
      size: days === 7 ? 4 : 2,
      strokeWidth: 2,
      hover: { sizeOffset: 2 },
    },
    grid: {
      borderColor: theme.palette.divider,
      strokeDashArray: 4,
      padding: { left: 8, right: 16 },
    },
    xaxis: {
      categories: rows.map((row) => row.day),
      tickAmount: days === 30 ? 5 : undefined,
      labels: {
        formatter: (value: string) => String(value ?? "").slice(5),
        rotate: 0,
        hideOverlappingLabels: true,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: { min: 0, forceNiceScale: true, labels: { formatter: number } },
    legend: { position: "top", horizontalAlign: "left" },
    tooltip: {
      shared: true,
      intersect: false,
      x: {
        formatter: (_value, options) => rows[options.dataPointIndex]?.day ?? "",
      },
      y: { formatter: (value: number) => `${number(value)} USD` },
    },
  };
  const formatValue = (value: number) =>
    funds ? asset(value, currency) : `${value} 张`;
  const donutOptions: ApexOptions = {
    ...common,
    colors,
    labels: composition.map((item) => item.label),
    legend: { show: false },
    stroke: { width: 3, colors: [theme.palette.background.paper] },
    plotOptions: {
      pie: {
        expandOnClick: false,
        donut: {
          size: "78%",
          labels: {
            show: true,
            name: { show: true },
            value: {
              formatter: (value: string) =>
                funds
                  ? number(Number(value) / (currency === "USD" ? 100 : 1000000))
                  : value,
              fontSize: "24px",
              fontWeight: 700,
              color: theme.palette.text.primary,
            },
            total: {
              show: true,
              showAlways: true,
              label: funds ? `${currency} 资金分布` : "全部卡片",
              formatter: () =>
                funds
                  ? number(total / (currency === "USD" ? 100 : 1000000))
                  : String(total),
              color: theme.palette.text.secondary,
            },
          },
        },
      },
    },
    tooltip: { y: { formatter: formatValue } },
    states: { active: { filter: { type: "none" } } },
  };
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          lg: "minmax(0, 1.6fr) minmax(0, 1fr)",
        },
        gap: 3,
      }}
    >
      <Card sx={{ minWidth: 0 }}>
        <CardHeader
          avatar={
            <Box color="primary.main" display="flex">
              <Icon icon="solar:chart-2-linear" width={24} />
            </Box>
          }
          title="消费与退款趋势"
          titleTypographyProps={{ variant: "h6" }}
          subheader="已完成卡片交易 · USD"
        />
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          flexWrap="wrap"
          sx={{ px: 3, mt: 2 }}
        >
          <Stack direction="row" gap={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                消费
              </Typography>
              <Typography variant="subtitle1">{asset(spend)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                退款
              </Typography>
              <Typography variant="subtitle1">{asset(refund)}</Typography>
            </Box>
          </Stack>
          <ToggleButtonGroup
            size="small"
            value={days}
            exclusive
            onChange={(_, value) => value && setDays(value)}
            aria-label="趋势统计天数"
          >
            <ToggleButton value={7}>近 7 天</ToggleButton>
            <ToggleButton value={30}>近 30 天</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Box
          role="img"
          aria-label={`已完成消费 ${asset(spend)}，退款 ${asset(refund)}。可展开数据明细查看每日数值。`}
          sx={{ px: 1, minHeight: 272 }}
        >
          {spend || refund ? (
            <Suspense
              fallback={<Skeleton variant="rectangular" height={272} />}
            >
              <Chart
                type="area"
                height={272}
                options={trendOptions}
                series={[
                  { name: "消费", data: rows.map((row) => row.spend / 100) },
                  { name: "退款", data: rows.map((row) => row.refund / 100) },
                ]}
              />
            </Suspense>
          ) : (
            <Box
              sx={{
                p: 3,
                minHeight: 272,
                display: "grid",
                alignContent: "center",
              }}
            >
              <Alert severity="info">
                当前范围没有已完成的 USD 消费或退款记录。
              </Alert>
            </Box>
          )}
        </Box>
        <Divider />
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          gap={1}
          sx={{ px: 3, py: 1.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            {rows.length
              ? `${rows[0].day} 至 ${rows.at(-1)!.day}`
              : "暂无有效交易日期"}
            <br />
            截至最新演示记录；无记录日期按 0 展示，不代表完整账单。
          </Typography>
          <Button
            size="small"
            onClick={() => setDetails(!details)}
            aria-expanded={details}
            aria-controls={`chart-data-${funds ? "funds" : "overview"}`}
          >
            {details ? "收起明细" : "数据明细"}
          </Button>
        </Stack>
        <Collapse in={details}>
          <TableContainer
            id={`chart-data-${funds ? "funds" : "overview"}`}
            sx={{ maxHeight: 280 }}
          >
            <Table size="small" stickyHeader aria-label="每日消费退款明细">
              <TableHead>
                <TableRow>
                  <TableCell>日期</TableCell>
                  <TableCell align="right">消费 · USD</TableCell>
                  <TableCell align="right">退款 · USD</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell>{row.day}</TableCell>
                    <TableCell align="right">
                      {number(row.spend / 100)}
                    </TableCell>
                    <TableCell align="right">
                      {number(row.refund / 100)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Collapse>
      </Card>
      <Card sx={{ minWidth: 0 }}>
        <CardHeader
          avatar={
            <Box color="primary.main" display="flex">
              <Icon icon="solar:pie-chart-2-linear" width={24} />
            </Box>
          }
          title={funds ? "资金构成" : "卡片状态分布"}
          titleTypographyProps={{ variant: "h6" }}
          subheader={funds ? "当前资金位置 · 含冻结及在途" : "按卡片数量统计"}
        />
        {funds && (
          <ToggleButtonGroup
            value={currency}
            size="small"
            exclusive
            onChange={(_, value) => value && setCurrency(value)}
            aria-label="资金构成币种"
            sx={{ mx: 3, mt: 2 }}
          >
            <ToggleButton value="USD">USD</ToggleButton>
            <ToggleButton value="USDT">USDT</ToggleButton>
          </ToggleButtonGroup>
        )}
        <Box
          role="img"
          aria-label={`${funds ? currency + "资金构成" : "卡片状态"}：${composition.map((item) => `${item.label} ${formatValue(item.value)}`).join("，")}`}
        >
          {total ? (
            <Suspense
              fallback={
                <Skeleton
                  variant="circular"
                  width={190}
                  height={190}
                  sx={{ mx: "auto", my: 3 }}
                />
              }
            >
              <Chart
                type="donut"
                height={230}
                options={donutOptions}
                series={composition.map((item) => item.value)}
              />
            </Suspense>
          ) : (
            <Box sx={{ p: 3 }}>
              <Alert severity="info">
                暂无可展示的{funds ? currency + "资金" : "卡片"}。
              </Alert>
            </Box>
          )}
        </Box>
        <Stack gap={1.25} sx={{ px: 3, pb: 3 }}>
          {composition.map((item, index) => (
            <Stack
              key={item.label}
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              gap={1}
            >
              <Stack direction="row" gap={1} alignItems="center">
                <Box sx={{ display: "flex", color: colors[index] }}>
                  <Icon icon={item.icon} width={18} />
                </Box>
                <Typography variant="body2">{item.label}</Typography>
              </Stack>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography variant="subtitle2">
                  {formatValue(item.value)}
                </Typography>
                <Chip
                  size="small"
                  label={`${total ? ((item.value / total) * 100).toFixed(1) : "0"}%`}
                  sx={{ minWidth: 54 }}
                />
              </Stack>
            </Stack>
          ))}
        </Stack>
        {funds && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", px: 3, pb: 2 }}
          >
            构成合计不是可用余额；不含待入账充值，也不跨币种合计。
          </Typography>
        )}
      </Card>
    </Box>
  );
}
