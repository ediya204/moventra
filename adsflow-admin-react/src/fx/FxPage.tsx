import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TablePagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import {
  DataGrid,
  GridToolbarColumnsButton,
  type GridColDef,
} from "@mui/x-data-grid";
import { zhCN } from "@mui/x-data-grid/locales";
import { Icon } from "@iconify/react";
import { get } from "../management/api";
import { ManagementAccess } from "../management/ManagementPage";
import { ignoresRowAction } from "../portal/rowInteraction";
import type { Money, Page, Transaction, Detail, Report } from "./types";
export const category: Record<string, string> = {
  purchase: "消费",
  refund: "退款",
  fee: "独立费用",
  fee_reversal: "费用冲回",
  cashback: "返现",
  cashback_adjustment: "返现调整",
  adjustment: "调整",
};
const treatments: Record<string, string> = {
  separate: "单独入账",
  included: "已包含在消费金额",
  unknown: "待确认",
};
export function formatMoney(m?: Money | null) {
  if (!m || m.scale < 0) return "—";
  const v = BigInt(m.minor),
    a = v < 0n ? -v : v,
    f = 10n ** BigInt(m.scale),
    whole = String(a / f).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${m.currency} ${v < 0n ? "-" : ""}${whole}${m.scale ? "." + String(a % f).padStart(m.scale, "0") : ""}`;
}
const valueMoney = (minor: string | undefined, currency = "USD", scale = 2) =>
  minor == null ? "—" : formatMoney({ minor, currency, scale });
const time = (s?: string | null) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(s))
    : "—";
function useData<T>(path: string, query: Record<string, unknown> = {}) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    key = JSON.stringify(query);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(undefined);
    get<T>(`fx/${path}`, JSON.parse(key))
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          if (e.status === 401)
            window.dispatchEvent(
              new Event("adsflow:management-session-expired"),
            );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, key, revision]);
  return { data, error, loading, reload: () => setRevision((v) => v + 1) };
}
function Notice({
  error,
  loading,
  reload,
}: {
  error: string;
  loading: boolean;
  reload: () => void;
}) {
  return (
    <>
      {loading && <LinearProgress aria-label="读取跨币种数据" />}
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={reload}>
              重试
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}
function Field({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <Box sx={{ minWidth: 180, flex: "1 1 220px", overflowWrap: "anywhere" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="div" variant="body2" sx={{ mt: 0.5 }}>
        {children ?? "—"}
      </Typography>
    </Box>
  );
}
function Fields({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={3}>
      {children}
    </Stack>
  );
}
function SimpleTable({
  heads,
  rows,
}: {
  heads: string[];
  rows: ReactNode[][];
}) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {heads.map((h) => (
              <TableCell key={h} sx={{ whiteSpace: "nowrap" }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((v, j) => (
                <TableCell
                  key={j}
                  sx={{
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {v ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={heads.length}>
                没有已采集记录。缺失信息不代表金额为零。
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
const href = (id: string, kind = "fx") =>
  kind === "legacy"
    ? `/transactions/${encodeURIComponent(id)}`
    : `/transactions/fx/${encodeURIComponent(id)}`;
export default function FxPage() {
  const { pathname } = useLocation(),
    parts = pathname.split("/"),
    view =
      parts[1] === "transactions"
        ? parts[2] === "fx"
          ? "transactions"
          : parts[2] || "transactions"
        : parts[2] || "transactions";
  if (["balances", "differences"].includes(view)) {
    return <Navigate to="/transactions" replace />;
  }
  return (
    <ManagementAccess key={pathname} title="卡交易流水">
      <Stack gap={3}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
        >
          <Box>
            <Typography variant="h4">卡交易流水</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              统一查询卡消费、退款和费用，按币种及入账状态筛选。
            </Typography>
          </Box>
          <Chip color="primary" variant="outlined" label="Demo / 模拟数据" />
        </Stack>
        <Alert severity="info">
          本地隔离数据 · 金额及关联为 Demo
          假设。原币和账户金额是同一笔交易的两个维度；仅实际入账流水计入净支出。
        </Alert>
        <Tabs
          value={view === "cards" ? "transactions" : view}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="跨币种管理导航"
        >
          {[
            ["transactions", "交易明细"],
            ["report", "跨币种报表"],
          ].map(([key, label]) => (
            <Tab
              key={key}
              value={key}
              label={label}
              component={Link}
              to={
                key === "transactions"
                  ? "/transactions"
                  : `/transactions/${key}`
              }
            />
          ))}
        </Tabs>
        {view === "transactions" ? (
          parts[3] ? (
            <TransactionDetail
              key={parts[3]}
              id={decodeURIComponent(parts[3])}
            />
          ) : (
            <TransactionList />
          )
        ) : view === "report" ? (
          <Reports />
        ) : view === "cards" && parts[3] ? (
          <CardPage id={decodeURIComponent(parts[3])} />
        ) : (
          <Alert severity="warning">页面不存在</Alert>
        )}
      </Stack>
    </ManagementAccess>
  );
}
function Filters({
  report = false,
  unified = false,
}: {
  report?: boolean;
  unified?: boolean;
}) {
  const [p, set] = useSearchParams(),
    [draft, setDraft] = useState(Object.fromEntries(p)),
    meta = useData<{ scenarios: [string, string][] }>("meta");
  const queryKey = p.toString();
  useEffect(
    () => setDraft(Object.fromEntries(new URLSearchParams(queryKey))),
    [queryKey],
  );
  const input = (
    key: string,
    label: string,
    options?: [string, string][],
    type?: string,
  ) => (
    <TextField
      key={key}
      label={label}
      size="small"
      select={!!options}
      type={type}
      value={draft[key] || ""}
      onChange={(e) => {
        const value = e.target.value;
        setDraft((prev) => ({ ...prev, [key]: value }));
      }}
      InputLabelProps={type === "date" ? { shrink: true } : undefined}
      sx={{ minWidth: 145, flex: options ? "0 1 175px" : "1 1 160px" }}
    >
      {options && [
        <MenuItem key="" value="">
          全部 / 默认
        </MenuItem>,
        ...options.map(([v, l]) => (
          <MenuItem key={v} value={v}>
            {l}
          </MenuItem>
        )),
      ]}
    </TextField>
  );
  const latestFilter = useRef({ draft, set });
  latestFilter.current = { draft, set };
  const applyFilters = () =>
    latestFilter.current.set({
      ...latestFilter.current.draft,
      page: "0",
      dailyPage: "0",
    });
  const activeAdvanced = [
    "catalog",
    "scenario",
    "platform",
    "account",
    "currency",
    "detailedStatus",
    "category",
    "timezone",
    "dateField",
  ].some((k) => p.get(k));
  return (
    <Stack
      component="form"
      gap={1.5}
      onSubmit={(e) => {
        e.preventDefault();
        applyFilters();
      }}
    >
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5}>
        {!report && input("q", "搜索商户 / ID / 订单")}
        {!report &&
          input("crossCurrency", "币种关系", [
            ["cross", "跨币种"],
            ["same", "同币种"],
            ["unknown", "币种待确认"],
          ])}
        {input("originalCurrency", "原币", [
          ["CNY", "CNY"],
          ["AED", "AED"],
          ["EUR", "EUR"],
          ["USD", "USD"],
          ["JPY", "JPY"],
        ])}
        {!report &&
          input("status", "入账状态", [
            ["pending", "待入账"],
            ["posted", "已入账"],
            ["failed", "失败"],
          ])}
        {report &&
          input("basis", "退款归属口径", [
            ["posted", "退款入账月份"],
            ["order", "原消费入账月份"],
          ])}
      </Stack>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5}>
        {input("from", "开始日期", undefined, "date")}
        {input("to", "结束日期", undefined, "date")}
        <Button
          type="button"
          onClick={applyFilters}
          variant="contained"
          startIcon={<Icon icon="solar:magnifer-linear" />}
        >
          查询
        </Button>
        <Button
          type="button"
          onClick={() => {
            set({});
            setDraft({});
          }}
        >
          重置
        </Button>
      </Stack>
      <Accordion
        disableGutters
        elevation={0}
        defaultExpanded={activeAdvanced}
        sx={{ background: "transparent", "&:before": { display: "none" } }}
      >
        <AccordionSummary
          expandIcon={<Icon icon="solar:alt-arrow-down-linear" />}
          sx={{ px: 0, minHeight: 36 }}
        >
          <Typography variant="body2" color="primary">
            高级筛选{activeAdvanced ? " · 已启用" : ""}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5}>
            {input(
              "scenario",
              "演示场景",
              (meta.data?.scenarios || []).filter(
                ([id]) => !report || id.startsWith("FX"),
              ),
            )}
            {unified &&
              input("catalog", "数据集", [
                ["fx", "跨币种验收数据"],
                ["legacy", "原有清算数据"],
              ])}
            {input("platform", "平台", [
              ["slash", "Slash"],
              ["demo-secondary", "其他平台 Demo"],
            ])}
            {input("account", "账户 ID")}
            {input("currency", "账户币种", [
              ["USD", "USD"],
              ["JPY", "JPY"],
            ])}
            {!report && input("category", "业务类型", Object.entries(category))}
            {!report &&
              input("detailedStatus", "详细状态", [
                ["pending", "待处理"],
                ["pending_approval", "待审批"],
                ["settled", "已结算"],
                ["refund", "退款"],
                ["reversed", "撤销"],
                ["declined", "拒绝"],
                ["failed", "失败"],
                ["dispute", "争议"],
                ["canceled", "取消"],
                ["returned", "退回"],
                ["in_review", "审核中"],
              ])}
            {input("timezone", "统计时区", [
              ["UTC", "UTC"],
              ["Asia/Hong_Kong", "香港 UTC+8"],
            ])}
            {!report &&
              input("dateField", "时间筛选字段", [
                ["source", "来源日期"],
                ["authorized", "授权时间"],
                ["posted", "入账时间"],
              ])}
          </Stack>
        </AccordionDetails>
      </Accordion>
      <Typography variant="caption" color="text.secondary">
        默认范围 2026-08-01 至 2026-09-30（含首尾日），默认 UTC。列表时间显示
        UTC；筛选按所选时区执行。
      </Typography>
    </Stack>
  );
}

function ColumnsToolbar() {
  return (
    <Stack direction="row" alignItems="center" gap={2} sx={{ p: 1 }}>
      <GridToolbarColumnsButton />
      <Typography variant="caption" color="text.secondary">
        服务端筛选、排序、分页 · 金额保留收支符号
      </Typography>
    </Stack>
  );
}
function TransactionList({
  differences = false,
  card,
}: {
  differences?: boolean;
  card?: string;
}) {
  const [p, set] = useSearchParams(),
    navigate = useNavigate(),
    unified = !differences && !card,
    q = {
      ...Object.fromEntries(p),
      ...(unified ? { unified: "yes" } : {}),
      ...(p.get("keyword") ? { q: p.get("keyword") } : {}),
      ...(p.get("cardId") ? { card: p.get("cardId") } : {}),
      ...(p.get("accountId") ? { account: p.get("accountId") } : {}),
      ...(card ? { card } : {}),
      pageSize: 25,
    },
    state = useData<Page>(differences ? "differences" : "transactions", q),
    [exportError, setExportError] = useState(""),
    [exporting, setExporting] = useState(false);
  const latestQuery = useRef({ p, set, q, loading: state.loading });
  latestQuery.current = { p, set, q, loading: state.loading };
  const cols: GridColDef<Transaction>[] = [
    {
      field: "description",
      headerName: "商户 / 交易",
      minWidth: 220,
      flex: 1,
      sortable: false,
      renderCell: (r) => (
        <Stack justifyContent="center" sx={{ height: "100%" }}>
          <Typography variant="body2">
            {r.row.source.description || "—"} · {category[r.row.category]}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {r.row.id}
          </Typography>
        </Stack>
      ),
    },
    {
      field: "original",
      headerName: "原币金额",
      width: 170,
      sortable: false,
      renderCell: (r) => formatMoney(r.row.originalAmount),
    },
    {
      field: "amount",
      headerName: "账户金额",
      width: 170,
      renderCell: (r) => formatMoney(r.row.accountAmount),
    },
    {
      field: "status",
      headerName: "入账 / 详细状态",
      width: 185,
      sortable: false,
      renderCell: (r) => (
        <Stack justifyContent="center" sx={{ height: "100%" }}>
          <Typography
            variant="body2"
            color={
              r.row.status === "failed"
                ? "error.main"
                : r.row.status === "pending"
                  ? "warning.main"
                  : "text.primary"
            }
          >
            {r.row.statusLabel}
          </Typography>
          <Typography variant="caption">{r.row.detailedStatusLabel}</Typography>
        </Stack>
      ),
    },
    {
      field: "authorizedAt",
      headerName: "授权时间 · UTC",
      width: 170,
      renderCell: (r) => time(r.row.authorizedAt),
    },
    {
      field: "postedAt",
      headerName: "入账时间 · UTC",
      width: 170,
      renderCell: (r) => time(r.row.postedAt),
    },
    {
      field: "sourceDate",
      headerName: "来源日期 · UTC",
      width: 170,
      renderCell: (r) => time(r.row.sourceDate),
    },
    {
      field: "category",
      headerName: "类型",
      width: 110,
      sortable: false,
      renderCell: (r) => category[r.row.category] || r.row.category,
    },
    { field: "platform", headerName: "平台", width: 120, sortable: false },
    { field: "scenario", headerName: "场景", width: 100, sortable: false },
    {
      field: "providerRate",
      headerName: "平台汇率",
      width: 190,
      sortable: false,
    },
    {
      field: "matching",
      headerName: "匹配状态",
      width: 145,
      sortable: false,
      renderCell: (r) => (r.row.issues.length ? "待确认" : "Demo 显式关联"),
    },
    {
      field: "action",
      headerName: "操作",
      width: 105,
      sortable: false,
      hideable: false,
      renderCell: (r) => (
        <Button
          component={Link}
          to={href(r.row.id, r.row.sourceKind)}
          size="small"
        >
          查看详情
        </Button>
      ),
    },
  ];
  return (
    <Stack gap={2}>
      {differences && (
        <Alert severity="warning">
          缺少规则、缺少关联和采集不完整的记录保留“待确认”；余额差异在账户余额中单独显示。
        </Alert>
      )}
      <Filters unified={unified} />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">
          {state.data?.total ?? "—"} 笔{differences ? "待确认记录" : "交易"}
          {card ? ` · ${card}` : ""}
        </Typography>
        <Button
          disabled={exporting || state.loading}
          startIcon={<Icon icon="solar:download-linear" />}
          onClick={async () => {
            setExporting(true);
            setExportError("");
            try {
              const d = await get<{ csv: string }>("fx/export", {
                ...latestQuery.current.q,
                ...(differences ? { issues: "yes" } : {}),
              });
              const url = URL.createObjectURL(
                new Blob([d.csv], { type: "text/csv;charset=utf-8" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "adsflow-cross-currency.csv";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setExportError((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          导出筛选结果
        </Button>
      </Stack>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      <Notice {...state} />
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <DataGrid
          autoHeight
          rowHeight={68}
          rows={state.data?.rows || []}
          columns={cols}
          loading={state.loading}
          localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
          disableColumnFilter
          disableRowSelectionOnClick
          paginationMode="server"
          sortingMode="server"
          rowCount={state.data?.total || 0}
          paginationModel={{ page: Number(p.get("page") || 0), pageSize: 25 }}
          onPaginationModelChange={(m) => {
            const latest = latestQuery.current;
            if (!latest.loading && m.page !== Number(latest.p.get("page") || 0))
              latest.set({
                ...Object.fromEntries(latest.p),
                page: String(m.page),
              });
          }}
          pageSizeOptions={[25]}
          sortModel={[
            {
              field: p.get("sort") || "sourceDate",
              sort: p.get("direction") === "asc" ? "asc" : "desc",
            },
          ]}
          onSortModelChange={(m) => {
            const sort = m[0]?.field || "sourceDate",
              direction = m[0]?.sort || "desc";
            const latest = latestQuery.current;
            if (
              sort !== (latest.p.get("sort") || "sourceDate") ||
              direction !== (latest.p.get("direction") || "desc")
            )
              latest.set({
                ...Object.fromEntries(latest.p),
                sort,
                direction,
                page: "0",
              });
          }}
          getRowId={(r) => `${r.sourceKind}:${r.id}`}
          initialState={{
            columns: {
              columnVisibilityModel: {
                sourceDate: false,
                category: false,
                platform: false,
                scenario: false,
                providerRate: false,
                matching: false,
              },
            },
          }}
          slots={{ toolbar: ColumnsToolbar }}
          onRowClick={(r, e) => {
            if (!ignoresRowAction(e))
              navigate(href(r.row.id, r.row.sourceKind));
          }}
          sx={{ border: 0, "& .MuiDataGrid-row": { cursor: "pointer" } }}
        />
      </Paper>
    </Stack>
  );
}
function TransactionDetail({ id }: { id: string }) {
  const state = useData<Detail>(`transactions/${encodeURIComponent(id)}`),
    d = state.data,
    r = d?.record,
    s = r?.source;
  return (
    <Stack gap={3}>
      <Stack direction="row" gap={1}>
        <Button
          component={Link}
          to="/transactions"
          startIcon={<Icon icon="solar:arrow-left-linear" />}
        >
          返回交易
        </Button>
        {s?.cardId && (
          <Button
            component={Link}
            to={`/transactions/cards/${encodeURIComponent(s.cardId)}`}
            startIcon={<Icon icon="solar:card-linear" />}
          >
            查看对应卡片
          </Button>
        )}
      </Stack>
      <Notice {...state} />
      {d && r && s && (
        <>
          <Section title={s.description || id}>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 3 }}>
              {id} · {category[r.category]} · {r.statusLabel} /{" "}
              {r.detailedStatusLabel}
            </Typography>
            <Fields>
              <Field label="原币金额">
                <Typography variant="h5">
                  {formatMoney(r.originalAmount)}
                </Typography>
              </Field>
              <Field
                label={
                  r.status === "posted"
                    ? "实际账户入账金额"
                    : "当前账户金额 · 非最终入账"
                }
              >
                <Typography variant="h5" color="primary">
                  {formatMoney(r.accountAmount)}
                </Typography>
              </Field>
              <Field label="平台汇率 · 原币 → 账户">
                {r.providerRate
                  ? `1 ${r.originalCurrency} = ${r.providerRate} ${r.accountAmount?.currency}`
                  : "— 来源未提供"}
              </Field>
              <Field label="派生展示比值 · 非平台汇率">
                {r.displayRatio
                  ? `1 ${r.originalCurrency} = ${r.displayRatio} ${r.accountAmount?.currency}`
                  : "—"}
                <Typography
                  variant="caption"
                  display="block"
                  color="text.secondary"
                >
                  {r.ratioBasis}
                </Typography>
              </Field>
            </Fields>
          </Section>
          <Section title="授权与入账变化">
            <Fields>
              <Field label="已采集的授权金额">
                {formatMoney(d.authorizationAmount)}
                {!d.authorizationAmount && " · 未知，未采集到授权金额"}
              </Field>
              <Field label="授权时间 · UTC">{time(r.authorizedAt)}</Field>
              <Field label="入账时间 · UTC">{time(r.postedAt)}</Field>
              <Field label={`Slash date · ${r.dateMeaning}`}>
                {time(r.sourceDate)}
              </Field>
            </Fields>
            <Divider sx={{ my: 2 }} />
            <SimpleTable
              heads={[
                "本地请求序号",
                "采集结果",
                "来源状态",
                "账户金额",
                "原币金额",
                "来源日期 UTC",
                "采集时间 UTC",
              ]}
              rows={d.history.rows.map((h) => [
                h.requestSequence,
                h.result === "applied" ? "已采纳" : "晚到 / 回退响应已隔离",
                `${h.source.status} / ${h.source.detailedStatus}`,
                formatMoney(h.accountAmount),
                formatMoney(h.originalAmount),
                time(h.source.date),
                time(h.collectedAt),
              ])}
            />
            <Typography variant="caption" color="text.secondary">
              {d.history.note}
            </Typography>
          </Section>
          <Section title="费用、退款与净支出">
            <Typography variant="body2" sx={{ mb: 2 }}>
              {d.net.scopeKind === "original_order"
                ? "原订单范围"
                : "未关联原订单 · 仅本记录"}
              ：
              <Button component={Link} to={href(d.net.scopeId)}>
                {d.net.scopeId}
              </Button>
            </Typography>
            <Fields>
              <Field label="外汇费说明">
                {valueMoney(d.fees.fx ?? undefined)} ·{" "}
                {treatments[d.fees.treatment]}
              </Field>
              <Field label="返现说明 · 不代表已到账">
                {valueMoney(d.fees.cashback ?? undefined)}
              </Field>
              <Field label="累计实际入账退款">
                {formatMoney(d.net.refund)}
              </Field>
              <Field label="已知原币净消费">
                {formatMoney(d.net.original)}
              </Field>
              <Field label="已知账户净支出">
                <Typography variant="h5" color="primary">
                  {formatMoney(d.net.account)}
                </Typography>
              </Field>
            </Fields>
            <SimpleTable
              heads={[
                "费用详情 ID",
                "类型 · Demo值",
                "金额说明（不重复计入）",
                "计费时间 UTC",
              ]}
              rows={d.feeDetails.map((f) => [
                f.id,
                f.feeType,
                valueMoney(f.feeAmountCents),
                time(f.dateCharged),
              ])}
            />
            <Typography variant="body2" color="text.secondary" sx={{ my: 2 }}>
              {d.net.note}
            </Typography>
            <Alert severity={d.net.confirmedWithinDemo ? "info" : "warning"}>
              {d.net.confirmedWithinDemo
                ? "Demo 算术核对通过；不代表真实 Slash 对账已确认。"
                : `待确认：${d.net.issues.join("；")}`}
            </Alert>
            <SimpleTable
              heads={[
                "关联记录",
                "类型 / 状态",
                "原币金额",
                "账户金额",
                "关联依据",
              ]}
              rows={d.relations.map((l) => [
                <Button component={Link} to={href(l.record.id)}>
                  {l.record.id}
                </Button>,
                `${category[l.record.category]} / ${l.record.statusLabel}`,
                formatMoney(l.record.originalAmount),
                formatMoney(l.record.accountAmount),
                l.evidence,
              ])}
            />
          </Section>
          <Section title="商户与平台标识">
            <Fields>
              <Field label="商户描述">{s.merchantData?.description}</Field>
              <Field label="MCC">{s.merchantData?.categoryCode}</Field>
              <Field label="商户地区">
                {s.merchantData?.location
                  ? Object.values(s.merchantData.location).join(" / ")
                  : "—"}
              </Field>
              <Field label="备注">{s.memo}</Field>
              <Field label="拒绝 / 通过原因">
                {s.declineReason || s.approvalReason}
              </Field>
              <Field label="平台 / 连接">
                {r.platform} / {r.connectionId}
              </Field>
              <Field label="所属实体">{r.entityId}</Field>
              <Field label="账户 / 子类型">
                {s.accountId} / {s.accountSubtype}
              </Field>
              <Field label="虚拟账户">{s.virtualAccountId}</Field>
              <Field label="订单号 · 非全局唯一">{s.orderId}</Field>
              <Field label="referenceNumber">{s.referenceNumber}</Field>
              <Field label="providerAuthorizationId">
                {s.providerAuthorizationId}
              </Field>
            </Fields>
          </Section>
          <Section title="数据来源与对账">
            <Fields>
              <Field label="最近采集时间 UTC">{time(r.collectedAt)}</Field>
              <Field label="同步状态">
                {r.syncState === "current" ? "本次采集已更新" : "待补同步"}
              </Field>
              <Field label="场景与匹配状态">
                {r.scenario} ·{" "}
                {r.matching === "unmatched" ? "未匹配" : "Demo 显式关系"}
              </Field>
            </Fields>
            <Typography variant="body2" sx={{ mt: 2 }}>
              {r.assumption}
              。已采集历史不等于完整平台事件历史。金额变化原因不自动判为汇兑损益。
            </Typography>
            <Accordion
              disableGutters
              elevation={0}
              sx={{ mt: 2, border: 1, borderColor: "divider" }}
            >
              <AccordionSummary
                expandIcon={<Icon icon="solar:alt-arrow-down-linear" />}
              >
                通知与投递记录（{d.events.length}）
              </AccordionSummary>
              <AccordionDetails>
                <SimpleTable
                  heads={[
                    "事件 ID",
                    "事件类型",
                    "来源事件时间 UTC",
                    "投递结果",
                  ]}
                  rows={d.events.map((e) => [
                    e.event_id,
                    e.event,
                    time(e.event_timestamp),
                    e.result,
                  ])}
                />
              </AccordionDetails>
            </Accordion>
            <Accordion disableGutters elevation={0}>
              <AccordionSummary
                expandIcon={<Icon icon="solar:alt-arrow-down-linear" />}
              >
                Slash 来源字段 · 白名单 / 数值字符串传输
              </AccordionSummary>
              <AccordionDetails>
                <Box
                  component="pre"
                  sx={{ fontSize: 12, overflow: "auto", m: 0 }}
                >
                  {JSON.stringify(s, null, 2)}
                </Box>
              </AccordionDetails>
            </Accordion>
          </Section>
        </>
      )}
    </Stack>
  );
}
function Reports() {
  const [p, set] = useSearchParams(),
    state = useData<Report>("report", Object.fromEntries(p)),
    d = state.data;
  const latestReportQuery = useRef({ p, set });
  latestReportQuery.current = { p, set };
  return (
    <Stack gap={3}>
      <Alert severity="info">
        此报表使用跨币种验收数据集；原有清算数据仍使用原报表口径。
        <Button component={Link} to="/reports">
          原有资金报表
        </Button>
      </Alert>
      <Filters report />
      <Notice {...state} />
      {d && (
        <>
          <Alert severity="info">
            {d.context.from} — {d.context.to} · {d.context.timezone} ·{" "}
            {d.context.basisLabel}。截至 {time(d.context.asOf)} UTC；
            {d.context.completeness}。未归属订单记录 {d.unassigned} 笔。
          </Alert>
          <Section title="账户资金 · 按账户币种及余额类型">
            <SimpleTable
              heads={[
                "账户 / 类型",
                "币种",
                "待入账消费",
                "已入账消费",
                "退款",
                "费用",
                "费用冲回",
                "待入账返现",
                "已入账返现",
                "返现调整",
                "其他调整",
                "已知入账支出",
                "已知入账收入",
                "已知净支出",
                "完整性",
              ]}
              rows={d.accounts.map((a) => [
                <Button
                  component={Link}
                  to={`/transactions?account=${a.accountId}`}
                >
                  {a.accountId} / {a.balanceType}
                </Button>,
                a.currency,
                ...[
                  a.pending.purchase,
                  a.posted.purchase,
                  a.posted.refund,
                  a.posted.fee,
                  a.posted.fee_reversal,
                  a.pending.cashback,
                  a.posted.cashback,
                  a.posted.cashback_adjustment,
                  a.posted.adjustment,
                  a.outflow,
                  a.inflow,
                  a.net,
                ].map((v) => valueMoney(v, a.currency, a.scale)),
                a.issues ? "待确认" : "Demo 已知流水",
              ])}
            />
            <TablePagination
              component="div"
              count={d.accountTotal}
              page={d.page}
              rowsPerPage={d.pageSize}
              rowsPerPageOptions={[25]}
              onPageChange={(_, page) =>
                latestReportQuery.current.set({
                  ...Object.fromEntries(latestReportQuery.current.p),
                  page: String(page),
                  dailyPage: "0",
                })
              }
            />
            <Typography variant="caption" color="text.secondary">
              空白类别显示“—”表示未采集该类别流水。总收支为选定范围已知流水之和；不包含费用说明和授权。不同余额类型不合并。
            </Typography>
          </Section>
          <Section title="原币消费 · 分币种统计">
            <SimpleTable
              heads={[
                "原币",
                "消费（支出负数）",
                "实际退款",
                "净消费",
                "缺失金额 / 单位",
              ]}
              rows={d.originals.map((o) => [
                o.currency,
                valueMoney(o.purchase, o.currency, o.scale),
                valueMoney(o.refund, o.currency, o.scale),
                valueMoney(o.net, o.currency, o.scale),
                o.unknown ? `${o.unknown} 笔 · 已知部分合计` : "Demo 已知金额",
              ])}
            />
          </Section>
          <Section title="每日净支出 · 当前账户页">
            <SimpleTable
              heads={["统计日期", "账户", "余额类型", "账户币种净支出"]}
              rows={d.daily.map((a) => [
                a.day,
                a.accountId,
                a.balanceType,
                valueMoney(a.net, a.currency, a.scale),
              ])}
            />
            <TablePagination
              component="div"
              count={d.dailyTotal}
              page={d.dailyPage}
              rowsPerPage={50}
              rowsPerPageOptions={[50]}
              onPageChange={(_, page) =>
                latestReportQuery.current.set({
                  ...Object.fromEntries(latestReportQuery.current.p),
                  dailyPage: String(page),
                })
              }
            />
          </Section>
        </>
      )}
    </Stack>
  );
}
function CardPage({ id }: { id: string }) {
  const state = useData<{
    card: { id: string; last4: string; status: string; accountId: string };
  }>(`cards/${encodeURIComponent(id)}`);
  return (
    <Stack gap={3}>
      <Button component={Link} to="/transactions" sx={{ alignSelf: "start" }}>
        返回卡交易流水
      </Button>
      <Notice {...state} />
      {state.data && (
        <Section title={`Demo 卡片 · ${state.data.card.last4}`}>
          <Fields>
            <Field label="卡片 ID">{id}</Field>
            <Field label="状态">
              {state.data.card.status === "active"
                ? "使用中"
                : state.data.card.status}
            </Field>
            <Field label="所属账户">{state.data.card.accountId}</Field>
            <Field label="有效期 / 限额">— 未采集</Field>
          </Fields>
        </Section>
      )}
      <TransactionList key={id} card={id} />
    </Stack>
  );
}
export function FxWorkbench() {
  const s = useData<Report>("report", { scenario: "FX01" }),
    a = s.data?.accounts[0],
    o = s.data?.originals[0];
  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 2, mb: 2 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ md: "center" }}
        justifyContent="space-between"
        gap={2}
      >
        <Box>
          <Typography variant="h6">
            <Icon
              icon="solar:transfer-horizontal-bold-duotone"
              color="#0078D4"
            />{" "}
            跨币种消费
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Demo 验收场景 FX01 · 授权、费用与退款分别核对
          </Typography>
        </Box>
        <Button component={Link} to="/transactions/report" variant="outlined">
          查看跨币种报表
        </Button>
      </Stack>
      <Notice {...s} />
      {a && o && (
        <Stack direction="row" flexWrap="wrap" gap={4} sx={{ mt: 2 }}>
          <Field label="原币净消费">
            {valueMoney(o.net, o.currency, o.scale)}
          </Field>
          <Field label="实际账户净支出">
            {valueMoney(a.net, a.currency, a.scale)}
          </Field>
          <Field label="数据范围">独立跨币种 Demo · UTC</Field>
        </Stack>
      )}
      {s.data && !a && (
        <Typography>尚未导入跨币种 Demo；运行 npm run fx:import。</Typography>
      )}
    </Paper>
  );
}
