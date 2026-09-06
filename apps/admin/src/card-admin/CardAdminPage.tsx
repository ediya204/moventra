import {isSlashDemoMode} from "../../../../packages/shared/src/utils/dataMode";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { zhCN } from "@mui/x-data-grid/locales";
import { Icon } from "@iconify/react";
import { get, post, exactUnits } from "../../../../packages/shared/src/management/api";
import { ManagementAccess } from "../management/ManagementPage";
import { PageHeader } from "../../../../packages/shared/src/components/PageHeader";
import { ignoresRowAction } from "../../../../packages/shared/src/portal/rowInteraction";
type Balance = {
  id: string;
  currency: string;
  postedMinor: string;
  heldMinor: string;
  availableMinor: string;
};
type Card = {
  id: string;
  name: string;
  last4: string | null;
  owner_id: string;
  status: string;
  provider_status: string;
  self_frozen: number;
  risk_frozen: number;
  reason: string | null;
  actor: string | null;
  operated_at: string | null;
  revision: number;
  balance: Balance | null;
  executionMode: string;
  fundingNote: string;
  actions: Record<string, { allowed: boolean; reason: string | null }>;
};
type Operation = {
  id: string;
  card_id: string;
  kind: string;
  requester: string;
  reason: string;
  evidence: string | null;
  amount_minor: string | null;
  currency: string | null;
  source_account: string | null;
  target_account: string | null;
  fee_minor: string;
  approval_status: string;
  execution_status: string;
  reviewer: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  executor: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
type Audit = {
  id: string;
  actor: string;
  action: string;
  note: string;
  created_at: string;
};
type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
type Detail = {
  card: Card;
  accounts: Balance[];
  operations: Page<Operation>;
  audit: Audit[];
  ledger: {
    id: string;
    operation_id: string | null;
    kind: string;
    created_at: string;
    amount_minor: string;
    account_id: string;
  }[];
};
type Quote = {
  amountMinor: string | null;
  currency: string | null;
  sourceAccount: string | null;
  targetAccount: string | null;
  sourceAvailableMinor: string;
  sourceAfterMinor: string;
  targetAfterMinor: string;
  feeMinor: string;
  policyVersion: string;
  cardRevision: number;
};
type Identity = { actor: string; permissions: string[] };
const kinds: Record<string, string> = {
  freeze: "风控冻结",
  unfreeze: "申请解除风控",
  debit: "强制扣款",
  transfer_in: "资金转入",
  transfer_out: "资金转出",
  self_freeze: "客户端冻结",
  self_unfreeze: "客户端解冻",
  opening: "测试期初",
};
const labels: Record<string, string> = {
  active: "使用中",
  paused: "渠道暂停",
  closed: "已关闭",
  inactive: "未激活",
  self_frozen: "自助冻结",
  risk_frozen: "风控冻结",
  pending: "待处理",
  approved: "审批通过",
  rejected: "审批拒绝",
  not_required: "免审批",
  processing: "执行中",
  succeeded: "执行成功",
  failed: "执行失败",
  not_executed: "未执行",
};
const money = (v?: string | null) => {
  if (v == null) return "—";
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return `USD ${n < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};
const time = (s?: string | null) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
function Status({ value }: { value: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={labels[value] || `未知 · ${value}`}
      color={
        ["failed", "rejected", "risk_frozen"].includes(value)
          ? "error"
          : ["pending", "processing", "paused"].includes(value)
            ? "warning"
            : value === "succeeded" || value === "active"
              ? "success"
              : "default"
      }
    />
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 180, flex: "1 1 210px", overflowWrap: "anywhere" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="div" sx={{ mt: 0.5 }}>
        {children ?? "—"}
      </Typography>
    </Box>
  );
}
function useData<T>(path: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [resource, search] = path.split("?");
      setData(
        await get<T>(
          `card-admin/${resource}`,
          Object.fromEntries(new URLSearchParams(search)),
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);
  return { data, error, loading, load };
}
function Notice({ error, loading }: { error: string; loading: boolean }) {
  return (
    <>
      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );
}
function GridRows({
  rows,
  columns,
  total,
  page,
  onPage,
  href,
}: {
  rows: { id: string }[];
  columns: GridColDef[];
  total: number;
  page: number;
  onPage: (n: number) => void;
  href?: (id: string) => string;
}) {
  const nav = useNavigate();
  return (
    <DataGrid
      autoHeight
      disableRowSelectionOnClick
      rows={rows}
      columns={columns}
      localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
      rowCount={total}
      paginationMode="server"
      sortingMode="server"
      disableColumnMenu
      paginationModel={{ page, pageSize: 10 }}
      pageSizeOptions={[10]}
      onPaginationModelChange={(p) => onPage(p.page)}
      onRowClick={(p, e) => {
        if (href && !ignoresRowAction(e)) nav(href(String(p.id)));
      }}
      sx={{
        border: 0,
        "& .MuiDataGrid-row": { cursor: href ? "pointer" : "default" },
      }}
    />
  );
}
export default function CardAdminPage() {
  return (
    <ManagementAccess title="卡片中心">
      <Workspace />
    </ManagementAccess>
  );
}
function Workspace() {
  const location = useLocation(),
    identity = useData<Identity>("identity"),
    [error, setError] = useState("");
  const parts = location.pathname.split("/"),
    operation = parts[1] === "card-operations",
    id = parts[2];
  return (
    <Stack gap={3}>
      <PageHeader
        title={operation ? "卡片操作审批" : id ? "卡片详情" : "卡片中心"}
        description="状态管理、双人审批和资金账本"
        breadcrumbs={[
          { label: "卡片中心", to: "/cards?source=demo" },
          ...(id ? [{ label: id }] : []),
        ]}
      />
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        gap={2}
        alignItems={{ md: "center" }}
      >
        <Alert severity="info" sx={{ flex: 1 }}>
          隔离测试环境 ·
          真实后端状态机与持久化账本；执行使用本地测试驱动，不扣划真实资金。
        </Alert>
        <TextField
          select
          size="small"
          label="测试操作身份"
          value={identity.data?.actor || "demo-operator"}
          onChange={async (e) => {
            const users: Record<string, string> = {
              "demo-operator": "demo@moventra.local",
              "demo-reviewer": "reviewer@example.com",
              "demo-viewer": "viewer@example.com",
            };
            try {
              await post("session", {
                username: users[e.target.value],
                password: "demo-only",
              });
              await identity.load();
              window.dispatchEvent(new Event("card-admin-identity"));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          sx={{ minWidth: 210 }}
        >
          <MenuItem value="demo-operator">发起人 · Demo 运营</MenuItem>
          <MenuItem value="demo-reviewer">复核人 · Demo 审核</MenuItem>
          <MenuItem value="demo-viewer">只读观察员</MenuItem>
        </TextField>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Tabs value={operation ? "operations" : "cards"}>
        <Tab label="卡片目录" value="cards" component={Link} to="/cards?source=demo" />
        <Tab
          label="卡操作审批"
          value="operations"
          component={Link}
          to="/card-operations"
        />
      </Tabs>
      <Box key={`${identity.data?.actor}-${location.pathname}`}>
        {operation ? (
          id ? (
            <OperationDetail id={id} identity={identity.data} />
          ) : (
            <OperationList />
          )
        ) : id ? (
          <CardDetail id={id} />
        ) : (
          <CardList />
        )}
      </Box>
    </Stack>
  );
}
function CardList() {
  const [p, set] = useSearchParams(),
    [keyword, setKeyword] = useState(p.get("keyword") || ""),
    page = Number(p.get("page") || 0),
    s = useData<Page<Card>>(`cards?${p}`);
  const cols: GridColDef[] = [
    {
      field: "name",
      headerName: "卡片 / 客户",
      flex: 1,
      minWidth: 230,
      renderCell: (x) => (
        <Stack justifyContent="center" height="100%">
          <Typography variant="body2">
            {x.row.name} · {x.row.last4 || "—"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {x.row.owner_id}
          </Typography>
        </Stack>
      ),
    },
    {
      field: "status",
      headerName: "当前状态",
      width: 130,
      renderCell: (x) => <Status value={x.value} />,
    },
    {
      field: "balance",
      headerName: "可扣资金",
      width: 155,
      valueGetter: (_, r) => money(r.balance?.availableMinor),
    },
    { field: "executionMode", headerName: "执行能力", width: 160 },
    { field: "reason", headerName: "最近操作原因", flex: 1, minWidth: 180 },
    {
      field: "action",
      headerName: "操作",
      width: 100,
      sortable: false,
      renderCell: (x) => (
        <Button component={Link} to={`/cards/${x.id}`}>
          查看详情
        </Button>
      ),
    },
  ];
  return (
    <Stack gap={2}>
      <Stack
        component="form"
        direction="row"
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          set({ source: "demo", keyword, page: "0" });
        }}
      >
        <TextField
          label="卡名、卡片 ID 或后四位"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          fullWidth
          size="small"
        />
        <Button type="submit" variant="contained">
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            set({source:"demo"});
          }}
        >
          重置
        </Button>
      </Stack>
      <Notice {...s} />
      <Paper variant="outlined">
        <GridRows
          rows={s.data?.rows || []}
          columns={cols.map((c) => ({ ...c, sortable: false }))}
          total={s.data?.total || 0}
          page={page}
          onPage={(page) =>
            set({ ...Object.fromEntries(p), page: String(page) })
          }
          href={(id) => `/cards/${id}`}
        />
      </Paper>
    </Stack>
  );
}
const operationColumns: GridColDef[] = [
  { field: "id", headerName: "操作单号", minWidth: 230, flex: 1 },
  {
    field: "kind",
    headerName: "操作",
    width: 135,
    valueGetter: (_, r) => kinds[r.kind] || r.kind,
  },
  {
    field: "amount_minor",
    headerName: "金额",
    width: 140,
    valueGetter: (_, r) => money(r.amount_minor),
  },
  {
    field: "approval_status",
    headerName: "审批状态",
    width: 120,
    renderCell: (p) => <Status value={p.value} />,
  },
  {
    field: "execution_status",
    headerName: "执行状态",
    width: 120,
    renderCell: (p) => <Status value={p.value} />,
  },
  { field: "requester", headerName: "发起人", width: 150 },
  {
    field: "action",
    headerName: "操作",
    width: 100,
    renderCell: (p) => (
      <Button component={Link} to={`/card-operations/${p.id}`}>
        查看详情
      </Button>
    ),
  },
];
export function CardApprovalEntry() {
  if(!isSlashDemoMode)return null;
  return (
    <Alert
      severity="info"
      action={
        <Button component={Link} to="/card-operations?status=pending">
          查看卡操作审批
        </Button>
      }
    >
      卡片解冻、扣款和资金划拨使用独立双人审批流程。
    </Alert>
  );
}
function OperationList() {
  const [p, set] = useSearchParams(),
    page = Number(p.get("page") || 0),
    s = useData<Page<Operation>>(`operations?${p}`);
  return (
    <Stack gap={2}>
      <TextField
        select
        size="small"
        label="审批状态"
        value={p.get("status") || ""}
        onChange={(e) => set({ status: e.target.value, page: "0" })}
        sx={{ maxWidth: 250 }}
      >
        <MenuItem value="">全部</MenuItem>
        {["pending", "approved", "rejected", "not_required"].map((v) => (
          <MenuItem key={v} value={v}>
            {labels[v]}
          </MenuItem>
        ))}
      </TextField>
      <Notice {...s} />
      <Paper variant="outlined">
        <GridRows
          columns={operationColumns.map((c) => ({ ...c, sortable: false }))}
          rows={s.data?.rows || []}
          total={s.data?.total || 0}
          page={page}
          onPage={(page) =>
            set({ ...Object.fromEntries(p), page: String(page) })
          }
          href={(id) => `/card-operations/${id}`}
        />
      </Paper>
    </Stack>
  );
}
function CardDetail({ id }: { id: string }) {
  const [p, set] = useSearchParams(),
    page = Number(p.get("page") || 0),
    s = useData<Detail>(`cards/${encodeURIComponent(id)}?page=${page}`),
    [kind, setKind] = useState("");
  if (!s.data) return <Notice {...s} />;
  const { card: c, accounts, operations } = s.data;
  return (
    <Stack gap={3}>
      <Notice {...s} />
      <Section title={`${c.name} · ${c.last4 || "—"}`}>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Field label="卡片状态">
            <Status value={c.status} />
          </Field>
          <Field label="渠道确认状态">
            <Status value={c.provider_status} />
          </Field>
          <Field label="冻结类型">
            {[
              c.risk_frozen ? "后台风控" : "",
              c.self_frozen ? "客户端主动" : "",
            ]
              .filter(Boolean)
              .join(" + ") || "无内部冻结"}
          </Field>
          <Field label="所属客户">{c.owner_id}</Field>
          <Field label="最近原因">{c.reason}</Field>
          <Field label="操作人 / 操作时间">
            {c.actor || "—"} / {time(c.operated_at)}
          </Field>
        </Stack>
      </Section>
      <Section title="资金与可执行操作">
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {c.fundingNote}
        </Typography>
        <Stack direction="row" gap={3} flexWrap="wrap">
          <Field label="已入账资金">{money(c.balance?.postedMinor)}</Field>
          <Field label="处理中的资金预占">{money(c.balance?.heldMinor)}</Field>
          <Field label="可扣 / 可转资金">
            {money(c.balance?.availableMinor)}
          </Field>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {Object.entries(c.actions).map(([k, a]) => (
            <Tooltip key={k} title={a.reason || kinds[k]}>
              <span>
                <Button
                  disabled={!a.allowed}
                  color={k === "freeze" || k === "debit" ? "error" : "primary"}
                  variant={k === "freeze" ? "contained" : "outlined"}
                  onClick={() => setKind(k)}
                  startIcon={
                    <Icon
                      icon={
                        k === "freeze"
                          ? "solar:shield-warning-linear"
                          : k === "unfreeze"
                            ? "solar:lock-unlocked-linear"
                            : "solar:transfer-horizontal-linear"
                      }
                    />
                  }
                >
                  {kinds[k]}
                </Button>
              </span>
            </Tooltip>
          ))}
        </Stack>
        {Object.values(c.actions).every((a) => !a.allowed) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {Object.values(c.actions)
              .map((a) => a.reason)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join("；")}
          </Alert>
        )}
        <Button component={Link} to={`/portal/cards/${id}`} sx={{ mt: 2 }}>
          查看客户端卡片
        </Button>
        {id.startsWith("DEMO-SLASH-") && (
          <Button component={Link} to={`/cards/${id}/source`}>
            查看来源卡片资料
          </Button>
        )}
      </Section>
      <Section title="审批与执行记录">
        <GridRows
          rows={operations.rows}
          columns={operationColumns.map((c) => ({ ...c, sortable: false }))}
          total={operations.total}
          page={page}
          onPage={(page) => set({ page: String(page) })}
          href={(id) => `/card-operations/${id}`}
        />
      </Section>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Section title="卡片资金流水">
            <Typography variant="caption" color="text.secondary">
              当前第 {page + 1} 页 · 每页最多 10 笔 · 金额由账本分录生成
            </Typography>
            {s.data.ledger.length ? (
              s.data.ledger.map((e) => (
                <Box
                  key={e.id}
                  sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
                >
                  <Stack direction="row" justifyContent="space-between">
                    <Typography>{kinds[e.kind] || e.kind}</Typography>
                    <Typography>{money(e.amount_minor)}</Typography>
                  </Stack>
                  <Typography variant="caption">
                    {time(e.created_at)}
                  </Typography>
                  {e.operation_id && (
                    <Button
                      size="small"
                      component={Link}
                      to={`/card-operations/${e.operation_id}`}
                    >
                      关联操作单
                    </Button>
                  )}
                </Box>
              ))
            ) : (
              <Typography color="text.secondary">暂无已入账分录</Typography>
            )}
            <Stack direction="row">
              <Button
                disabled={page === 0}
                onClick={() => set({ page: String(page - 1) })}
              >
                上一页
              </Button>
              <Button
                disabled={s.data.ledger.length < 10 && s.data.audit.length < 10}
                onClick={() => set({ page: String(page + 1) })}
              >
                下一页
              </Button>
            </Stack>
          </Section>
        </Grid>
        <Grid item xs={12} md={6}>
          <Section title="操作审计">
            <AuditList rows={s.data.audit} />
          </Section>
        </Grid>
      </Grid>
      {kind && (
        <ActionDialog
          card={c}
          accounts={accounts}
          kind={kind}
          onClose={() => setKind("")}
          onDone={() => {
            setKind("");
            void s.load();
          }}
        />
      )}
    </Stack>
  );
}
function AuditList({ rows }: { rows: Audit[] }) {
  return rows.length ? (
    <Stack divider={<Divider />} gap={1}>
      {rows.map((a) => (
        <Box key={a.id}>
          <Typography variant="body2">{a.note}</Typography>
          <Typography variant="caption" color="text.secondary">
            {a.actor} · {a.action} · {time(a.created_at)}
          </Typography>
        </Box>
      ))}
    </Stack>
  ) : (
    <Typography color="text.secondary">暂无记录</Typography>
  );
}
function ActionDialog({
  card,
  accounts,
  kind,
  onClose,
  onDone,
}: {
  card: Card;
  accounts: Balance[];
  kind: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const nav = useNavigate(),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState(""),
    [amount, setAmount] = useState(""),
    [account, setAccount] = useState(accounts[0]?.id || ""),
    [quote, setQuote] = useState<Quote>(),
    [requestId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const funds = ["debit", "transfer_in", "transfer_out"].includes(kind);
  const body = () => ({
    kind,
    reason,
    evidence,
    ...(funds
      ? {
          amountMinor: String(exactUnits(amount, 2)),
          currency: "USD",
          counterpartyAccount: account,
        }
      : {}),
    cardRevision: quote?.cardRevision ?? card.revision,
  });
  const preview = async () => {
    setBusy(true);
    setError("");
    try {
      if (!reason.trim() || (funds && !evidence.trim()))
        throw new Error("请填写原因和业务凭证");
      setQuote(
        await post<Quote>(`card-admin/cards/${card.id}/preview`, body()),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await post<Operation>(
        `card-admin/cards/${card.id}/operations`,
        { ...body(), requestId, confirmed: true },
      );
      onDone();
      nav(`/card-operations/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {quote ? "确认提交 · " : ""}
        {kinds[kind]}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <Typography>
            {card.name} · {card.last4}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {quote ? (
            <>
              <Alert severity="warning">
                {kind === "freeze"
                  ? "提交后立即建立本系统风控限制，渠道状态等待执行确认。"
                  : "提交后等待另一名有权限的操作员审批。审批通过后执行，最终结果单独展示。"}
              </Alert>
              <Field label="操作原因">{reason}</Field>
              {funds && (
                <>
                  <Field label="金额 / 费用">
                    {money(quote.amountMinor)} / {money(quote.feeMinor)}
                  </Field>
                  <Field label="资金来源 → 去向">
                    {quote.sourceAccount} → {quote.targetAccount}
                  </Field>
                  <Field label="来源可用余额 → 预计余额">
                    {money(quote.sourceAvailableMinor)} →{" "}
                    {money(quote.sourceAfterMinor)}
                  </Field>
                  <Field label="业务凭证">{evidence}</Field>
                </>
              )}
            </>
          ) : (
            <>
              {funds && (
                <>
                  <TextField
                    label="金额 · USD"
                    inputProps={{ inputMode: "decimal" }}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  {kind !== "debit" && (
                    <TextField
                      select
                      label={
                        kind === "transfer_in"
                          ? "来源客户资金账户"
                          : "目标客户资金账户"
                      }
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <MenuItem key={a.id} value={a.id}>
                          {a.id} · 可用 {money(a.availableMinor)}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <Alert severity="info">
                    {kind === "debit"
                      ? "资金划至平台应收结算账户，用于有凭证的应收款收取。"
                      : "仅在同客户 USD 测试资金账户与卡分户账之间划拨，不属于外部充值或提现。"}
                    本地测试费率为 0。
                  </Alert>
                  <TextField
                    label="业务凭证编号（请勿填写敏感卡信息）"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    inputProps={{ maxLength: 500 }}
                  />
                </>
              )}
              <TextField
                label="操作原因"
                multiline
                minRows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                inputProps={{ maxLength: 500 }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          disabled={busy}
          onClick={quote ? () => setQuote(undefined) : onClose}
        >
          {quote ? "返回修改" : "取消"}
        </Button>
        <Button
          disabled={busy}
          variant="contained"
          onClick={quote ? submit : preview}
        >
          {busy
            ? "处理中…"
            : quote
              ? "确认提交"
              : funds
                ? "试算并确认"
                : "下一步确认"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function OperationDetail({
  id,
  identity,
}: {
  id: string;
  identity?: Identity;
}) {
  const s = useData<{
      operation: Operation;
      audit: Audit[];
      job: { status: string; provider_ref: string; result: string } | null;
      entries: { account_id: string; amount_minor: string; currency: string }[];
    }>(`operations/${id}`),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!s.data) return <Notice {...s} />;
  const o = s.data.operation;
  const canReview =
    identity?.permissions.includes("card.approve") &&
    identity.actor !== o.requester;
  const action = async (decision: string) => {
    setBusy(true);
    try {
      await post(`card-admin/operations/${id}/review`, { decision, note });
      setError("");
      await s.load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={3}>
      <Notice {...s} />
      {error && <Alert severity="error">{error}</Alert>}
      <Section title={kinds[o.kind] || o.kind}>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Field label="操作单号">{o.id}</Field>
          <Field label="卡片">
            <Button component={Link} to={`/cards/${o.card_id}`}>
              {o.card_id}
            </Button>
          </Field>
          <Field label="审批状态">
            <Status value={o.approval_status} />
          </Field>
          <Field label="执行状态">
            <Status value={o.execution_status} />
          </Field>
          <Field label="发起人 / 时间">
            {o.requester} / {time(o.created_at)}
          </Field>
          <Field label="原因">{o.reason}</Field>
          <Field label="金额 / 费用">
            {money(o.amount_minor)} /{" "}
            {o.amount_minor ? money(o.fee_minor) : "不适用"}
          </Field>
          <Field label="资金来源 → 去向">
            {o.source_account
              ? `${o.source_account} → ${o.target_account}`
              : "不涉及资金"}
          </Field>
          <Field label="业务凭证">{o.evidence}</Field>
          <Field label="审批人 / 审批时间">
            {o.reviewer || "—"} / {time(o.reviewed_at)}
          </Field>
          <Field label="审批意见">{o.review_note}</Field>
          <Field label="执行人">{o.executor}</Field>
          <Field label="执行凭据">{s.data.job?.provider_ref || "—"}</Field>
        </Stack>
        {o.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {o.error}
          </Alert>
        )}
        {o.execution_status === "processing" && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            等待渠道最终结果，不能将审批通过当作完成；资金操作保留预占。
            {s.data.job?.result}
          </Alert>
        )}
      </Section>
      {o.approval_status === "pending" && (
        <Section title="审批意见">
          {!canReview ? (
            <Alert severity="info">
              {identity?.actor === o.requester
                ? "不能审批本人发起的操作，请由另一名复核人处理。"
                : "当前身份没有卡片审批权限。"}
            </Alert>
          ) : (
            <Stack gap={2}>
              <TextField
                multiline
                minRows={3}
                label="审批意见（必填）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                inputProps={{ maxLength: 500 }}
              />
              <Stack direction="row" gap={1}>
                <Button
                  disabled={busy || !note.trim()}
                  variant="contained"
                  onClick={() => action("approve")}
                >
                  批准并执行
                </Button>
                <Button
                  disabled={busy || !note.trim()}
                  color="error"
                  variant="outlined"
                  onClick={() => action("reject")}
                >
                  拒绝申请
                </Button>
              </Stack>
            </Stack>
          )}
        </Section>
      )}
      {o.execution_status === "processing" &&
        identity?.permissions.includes("card.execute") && (
          <Button
            sx={{ alignSelf: "start" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`card-admin/operations/${id}/refresh`, {});
                await s.load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            查询执行结果（不重新扣款）
          </Button>
        )}
      {s.data.entries.length > 0 && (
        <Section title="双边资金分录">
          <Stack gap={1}>
            {s.data.entries.map((e) => (
              <Stack
                key={e.account_id}
                direction="row"
                justifyContent="space-between"
              >
                <Typography>{e.account_id}</Typography>
                <Typography>{money(e.amount_minor)}</Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}
      <Section title="处理记录">
        <AuditList rows={s.data.audit} />
      </Section>
    </Stack>
  );
}
