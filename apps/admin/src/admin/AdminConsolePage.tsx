import {CardApprovalEntry} from '../card-admin/CardAdminPage';
import {LiveSyncStatus} from '../slash/LiveSlashPage';
import FundsOverview from '../operations/FundsOverview';
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Icon } from "@iconify/react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  DataGrid,
  type GridRenderCellParams,
  type GridColDef,
} from "@mui/x-data-grid";
import { zhCN } from "@mui/x-data-grid/locales";
import { ManagementAccess } from "../management/ManagementPage";
import {
  get,
  post,
  decimal,
  labels,
  type Group,
  type User,
  type Page,
} from "../../../../packages/shared/src/management/api";
import { PageHeader } from "../../../../packages/shared/src/components/PageHeader";
import { ignoresRowAction } from "../../../../packages/shared/src/portal/rowInteraction";
import { navigationGroups } from "./navigation";
import { isSlashDemoMode } from "../../../../packages/shared/src/utils/dataMode";
import { useAuth } from "../../../../packages/shared/src/auth/AuthContext";

type Settings = {
  workspaceName: string;
  notice: string;
  revision: number;
  updatedAt: string | null;
};
type Log = {
  id: string;
  actor: string;
  action: string;
  targetId: string;
  targetType: string;
  description: string;
  createdAt: string;
};
type Overview = {
  asOf: string;
  namespace: string;
  settings: Settings;
  users: { status: string; count: number }[];
  groups: { status: string; count: number }[];
  customFeeUsers: number;
  pending: Page<User>;
  audit: Page<Log>;
};
type Order = {
  id: string;
  name: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  time: string;
  orderId: string;
  card?: { id: string; name: string; last4: string };
  finance?: {
    currency: string;
    toCurrency?: string;
    fee?: number;
    receive?: number;
  };
};
type System = {
  namespace: string;
  checkedAt: string;
  storage: string;
  migrations: number[];
  sourceRecords: { kind: string; count: number }[];
  latestCollectedAt: string | null;
  roles: { id: string; label: string; permissions: string[] }[];
  channels: { id: string; name: string; mode: string; description: string }[];
};
const titles: Record<string, string> = {
  "/workbench": "管理总览",
  "/approvals": "审批中心",
  "/pricing": "费率管理",
  "/finance/orders": "资金订单",
  "/system/audit": "操作日志",
  "/system/channels": "渠道与数据",
  "/system/access": "访问权限",
  "/system/settings": "后台设置",
};
const actionNames: Record<string, string> = {
 "channel.create":"创建发卡渠道", "channel.update":"维护发卡渠道", "channel.import":"导入产品目录",
 "bin.create":"创建卡BIN产品", "bin.update":"维护卡BIN产品",
  "group.create": "创建费率方案",
  "user.opening": "提交开户",
  "opening.review": "开户审核",
  "fees.update": "调整费率",
  "status.update": "变更状态",
  "user.profile": "编辑用户",
  "group.profile": "编辑费率方案",
  "password.reset_requested": "创建重置链接",
  "password.reset_completed": "完成密码重置",
  "settings.update": "更新后台设置",
};
const time = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
function money(amount: number | undefined, currency: string) {
  if (amount === undefined) return "—";
  return `${amount < 0 ? "−" : ""}${decimal(Math.abs(amount), currency === "USDT" ? 6 : 2)} ${currency}`;
}
function logHref(row: Log) {
 if(row.targetType==="channels")return `/card-bins/channels/${encodeURIComponent(row.targetId)}`;
 if(row.targetType==="groups")return `/pricing/plans/${encodeURIComponent(row.targetId)}?tab=fees`;
 if(row.targetType==="bins")return `/card-bins/${encodeURIComponent(row.targetId)}`;
  return row.targetType === "settings"
    ? "/system/settings"
    : `/user-groups/${row.targetType}/${encodeURIComponent(row.targetId)}`;
}
function State({ value }: { value: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={labels[value] || value}
      color={
        value === "pending"
          ? "warning"
          : value === "active"
            ? "success"
            : "default"
      }
    />
  );
}
function useData<T>(path: string, query: Record<string, unknown> = {}) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const key = JSON.stringify(query);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    get<T>(path, JSON.parse(key))
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, key, version]);
  return {
    data,
    error,
    loading,
    reload: useCallback(() => setVersion((v) => v + 1), []),
  };
}
function LoadingError({
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
      {loading && <LinearProgress aria-label="正在读取管理数据" />}
      {error && (
        <Alert
          severity="error"
          action={
            <Button onClick={reload} color="inherit">
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
function GridList({
  data,
  columns,
  loading,
  page,
  change,
  href,
}: {
  data?: Page<any>;
  columns: GridColDef[];
  loading: boolean;
  page: number;
  change: (p: number) => void;
  href: (row: any) => string;
}) {
  const navigate = useNavigate();
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <DataGrid
        autoHeight
        rows={data?.rows || []}
        columns={[
          ...columns,
          {
            field: "_detail",
            headerName: "操作",
            width: 105,
            renderCell: (p: GridRenderCellParams) => (
              <Button component={Link} to={href(p.row)}>
                查看详情
              </Button>
            ),
          },
        ].map((c) => ({ ...c, sortable: false }))}
        loading={loading}
        disableRowSelectionOnClick
        disableColumnFilter
        paginationMode="server"
        rowCount={data?.total || 0}
        pageSizeOptions={[10]}
        paginationModel={{ page, pageSize: 10 }}
        onPaginationModelChange={(m) => change(m.page)}
        localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
        onRowClick={(r, e) => {
          if (!ignoresRowAction(e)) navigate(href(r.row));
        }}
      />
    </Paper>
  );
}
function useFilters() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get("page")) || 0);
  const change = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.delete("page");
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    setParams(p);
  };
  return { params, page, change };
}
export default function AdminConsolePage() {
  const { pathname } = useLocation();
  const title = titles[pathname] || "资金订单详情";
  return (
    <ManagementAccess title={title}>
      <Stack gap={3}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          <Chip
            label="本地管理 Demo"
            size="small"
            variant="outlined"
            color="primary"
          />
          <Typography variant="caption" color="text.secondary">
            管理数据与线上只读业务分开核算
          </Typography>
        </Box>
        {pathname === "/workbench" ? (
          <OverviewPage />
        ) : pathname === "/approvals" ? (
          <ApprovalsPage />
        ) : pathname === "/pricing" ? (
          <PricingPage />
        ) : pathname === "/system/audit" ? (
          <AuditPage />
        ) : pathname === "/system/settings" ? (
          <SettingsPage />
        ) : pathname.startsWith("/system/") ? (
          <SystemPage access={pathname.endsWith("/access")} />
        ) : pathname === "/finance/orders" ? (
          <OrdersPage />
        ) : (
          <OrderPage id={decodeURIComponent(pathname.split("/").at(-1)!)} />
        )}
      </Stack>
    </ManagementAccess>
  );
}
function OverviewPage() {
  const state = useData<Overview>("console/overview"),
    d = state.data;
  const count = (status: string) =>
    d?.users.find((s) => s.status === status)?.count ?? 0;
  const total = d?.users.reduce((sum, r) => sum + r.count, 0) || 0;
  const groups = d?.groups.reduce((sum, r) => sum + r.count, 0);
  return (
    <>
      <PageHeader
        title={d?.settings.workspaceName || "管理总览"}
        description="从待办出发，管理客户、资金与业务配置。"
        action={
          <Stack direction="row" gap={1}>
            <Button
              variant="outlined"
              onClick={state.reload}
              startIcon={<Icon icon="solar:refresh-linear" />}
            >
              刷新
            </Button>
            <Button
              variant="contained"
              component={Link}
              to="/user-groups/new-user"
              startIcon={<Icon icon="solar:user-plus-linear" />}
            >
              新增用户
            </Button>
          </Stack>
        }
      />
      <LoadingError {...state} />
      {d?.settings.notice && <Alert severity="info">{d.settings.notice}</Alert>}
      <FundsOverview source="local"/>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" },
          borderTop: 1,
          borderBottom: 1,
          borderColor: "divider",
          py: 2,
          gap: 2,
        }}
      >
        {[
          {
            title: "待审核开户",
            value: d?.pending.total,
            path: "/approvals",
            icon: "user-check-rounded",
            sub: "需核对申请资料",
          },
          {
            title: "启用用户",
            value: d ? count("active") : undefined,
            path: "/user-groups/users?status=active",
            icon: "users-group-rounded",
            sub: "本地客户目录",
          },
          {
            title: "费率方案",
            value: groups,
            path: "/pricing",
            icon: "folder-with-files",
            sub: "统一维护客户费率方案",
          },
          {
            title: "专属费率用户",
            value: d?.customFeeUsers,
            path: "/pricing",
            icon: "tag-price",
            sub: "至少一项用户覆盖",
          },
        ].map((m) => (
          <Box key={m.title} sx={{ px: { xs: 1, md: 2 } }}>
            <Stack
              direction="row"
              alignItems="center"
              gap={1}
              color="text.secondary"
            >
              <Icon icon={`solar:${m.icon}-linear`} width={18} />
              <Typography variant="body2">{m.title}</Typography>
            </Stack>
            <Typography
              component={Link}
              to={m.path}
              variant="h4"
              sx={{
                display: "inline-block",
                my: 1,
                color: "text.primary",
                textDecoration: "none",
                "&:hover": { color: "primary.main" },
              }}
            >
              {m.value ?? "—"}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              {m.sub}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1.6fr) minmax(280px,1fr)",
          },
          gap: 3,
        }}
      >
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">优先处理</Typography>
            <Button component={Link} to="/approvals">
              全部审批
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={2}>
            开户申请 · 最近提交
          </Typography>
          {!d ? (
            <Typography color="text.secondary">
              {state.error ? "读取失败，请重试" : "正在读取…"}
            </Typography>
          ) : d.pending.rows.length ? (
            <List disablePadding>
              {d.pending.rows.map((u) => (
                <ListItemButton
                  component={Link}
                  to={`/user-groups/users/${u.id}`}
                  key={u.id}
                  sx={{
                    px: 0,
                    borderBottom: 1,
                    borderColor: "divider",
                    gap: 2,
                  }}
                >
                  <Box sx={{ color: "primary.main" }}>
                    <Icon icon="solar:user-check-rounded-linear" width={22} />
                  </Box>
                  <ListItemText
                    primary={u.name}
                    secondary={`${u.groupName} · ${u.email}`}
                    primaryTypographyProps={{ fontWeight: 600 }}
                    secondaryTypographyProps={{
                      sx: { overflowWrap: "anywhere" },
                    }}
                  />
                  <Chip
                    size="small"
                    label="待审核"
                    color="warning"
                    variant="outlined"
                  />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <Stack py={3} gap={1}>
              <Typography>当前没有待审核开户</Typography>
              <Typography variant="body2" color="text.secondary">
                新申请提交后会出现在这里。
              </Typography>
              <Button
                sx={{ alignSelf: "flex-start" }}
                component={Link}
                to="/user-groups/new-user"
              >
                创建开户申请
              </Button>
            </Stack>
          )}
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6">客户状态分布</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            本地客户共 {d ? total : "—"} 位
          </Typography>
          <Stack gap={2}>
            {["active", "pending", "disabled", "rejected"].map((status) => (
              <Box key={status}>
                <Stack direction="row" justifyContent="space-between" mb={0.7}>
                  <Typography variant="body2">{labels[status]}</Typography>
                  <Typography variant="body2">
                    {d ? count(status) : "—"}
                  </Typography>
                </Stack>
                <LinearProgress
                  aria-label={`${labels[status]}用户占比`}
                  variant="determinate"
                  value={total ? (count(status) / total) * 100 : 0}
                  color={status === "pending" ? "warning" : "primary"}
                  sx={{ height: 6, borderRadius: 1, bgcolor: "grey.200" }}
                />
              </Box>
            ))}
          </Stack>
        </Paper>
      </Box>
      <Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Typography variant="h6">管理领域</Typography>
          <Typography variant="caption" color="text.secondary">
            按职责进入业务
          </Typography>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            columnGap: 5,
          }}
        >
          {navigationGroups(isSlashDemoMode).map((g) => (
            <Box
              key={g.label}
              sx={{ py: 2, borderBottom: 1, borderColor: "divider" }}
            >
              <Stack direction="row" gap={1.5} alignItems="center">
                <Box color="primary.main">
                  <Icon icon={g.icon} width={23} />
                </Box>
                <Typography variant="subtitle1">{g.label}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" my={1}>
                {g.description}
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5}>
                {g.items.map((i) => (
                  <Button
                    key={i.path}
                    size="small"
                    component={Link}
                    to={i.path}
                  >
                    {i.label}
                  </Button>
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      </Box>
      <Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="h6">最近管理操作</Typography>
          <Button component={Link} to="/system/audit">
            查看操作日志
          </Button>
        </Stack>
        {d?.audit.rows.length ? (
          <List>
            {d.audit.rows.map((l) => (
              <ListItemButton
                key={l.id}
                component={Link}
                to={logHref(l)}
                sx={{ px: 0, gap: 2 }}
              >
                <ListItemIcon>
                  <Icon icon="solar:document-text-linear" width={20} />
                </ListItemIcon>
                <ListItemText
                  primary={actionNames[l.action] || l.action}
                  secondary={l.description}
                  secondaryTypographyProps={{ noWrap: true }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0 }}
                >
                  {time(l.createdAt)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Typography color="text.secondary" py={2}>
            {d ? "尚无管理操作记录" : "—"}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          更新于 {time(d?.asOf)} · 卡片所属用户读取内部数据库绑定；未绑定记录单独标注
        </Typography>
      </Box>
    </>
  );
}
function ApprovalsPage() {
  const { params, page, change } = useFilters(),
    status = params.get("status") || "pending";
  const [keyword, setKeyword] = useState(params.get("keyword") || "");
  const state = useData<Page<User>>("users", {
    page,
    pageSize: 10,
    status,
    keyword: params.get("keyword"),
  });
  const columns: GridColDef[] = [
    { field: "name", headerName: "申请用户", minWidth: 160, flex: 1 },
    { field: "email", headerName: "邮箱", minWidth: 220, flex: 1 },
    { field: "groupName", headerName: "费率方案", width: 140 },
    {
      field: "status",
      headerName: "状态",
      width: 110,
      renderCell: (p) => <State value={p.value} />,
    },
    {
      field: "created_at",
      headerName: "申请时间",
      width: 190,
      valueFormatter: (v) => time(v),
    },
  ];
  return (
    <>
      <PageHeader
        title="审批中心"
        description="分别处理开户申请与卡片敏感操作；卡片操作审批通过后独立执行。"
      />
      <CardApprovalEntry/>
      <Tabs value={status} onChange={(_, v) => change({ status: v })}>
        {Object.entries(labels)
          .sort(([a], [b]) => (a === "pending" ? -1 : b === "pending" ? 1 : 0))
          .map(([v, l]) => (
            <Tab key={v} value={v} label={l} />
          ))}
      </Tabs>
      <Stack
        component="form"
        direction="row"
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          change({ keyword });
        }}
      >
        <TextField
          label="姓名、邮箱或用户编号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          fullWidth
        />
        <Button variant="contained" type="submit">
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            change({ keyword: "" });
          }}
        >
          重置
        </Button>
      </Stack>
      <LoadingError {...state} />
      <GridList
        {...state}
        page={page}
        change={(p) => change({ page: String(p) })}
        columns={columns}
        href={(r) => `/user-groups/users/${r.id}`}
      />
      <Alert severity="info">
        资金划转和渠道开户未接入此审批队列。已启用列表也包含初始化用户，不等同于审核历史；审核历史见操作日志。
      </Alert>
    </>
  );
}
function PricingPage() {
  const { params, page, change } = useFilters();
  const [keyword, setKeyword] = useState(params.get("keyword") || "");
  const state = useData<Page<Group>>("groups", {
    page,
    pageSize: 10,
    keyword: params.get("keyword"),
  });
  return (
    <>
      <PageHeader
        title="费率管理"
        description="先确定方案默认价格，再针对客户设置专属费率。"
        action={
          <Stack direction="row" gap={1}>
            <Button component={Link} to="/pricing/plans" variant="contained">维护费率方案</Button>
            <Button component={Link} to="/user-groups/users">查找用户专属费率</Button>
          </Stack>
        }
      />
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          divider={<Divider orientation="vertical" flexItem />}
        >
          {["01  用户专属配置", "02  所选方案默认费率", "03  系统演示默认"].map(
            (v) => (
              <Typography key={v} variant="subtitle2">
                {v}
              </Typography>
            ),
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" mt={1.5}>
          依次取首个有效配置；明确设置 0 表示免费。充值、兑换、提现、开卡等共 10
          类费用，支持百分比加固定金额。
        </Typography>
      </Paper>
      <Stack
        component="form"
        direction="row"
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          change({ keyword });
        }}
      >
        <TextField
          label="搜索费率方案"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          fullWidth
        />
        <Button type="submit" variant="contained">
          查询
        </Button>
      </Stack>
      <LoadingError {...state} />
      <GridList
        {...state}
        page={page}
        change={(p) => change({ page: String(p) })}
        columns={[
          { field: "name", headerName: "费率方案", flex: 1, minWidth: 180 },
          { field: "description", headerName: "说明", flex: 1, minWidth: 200 },
          { field: "memberCount", headerName: "客户数", width: 110 },
          {
            field: "status",
            headerName: "状态",
            width: 120,
            renderCell: (p) => <State value={p.value} />,
          },
        ]}
        href={(r) => `/pricing/plans/${r.id}?tab=fees`}
      />
      <Alert severity="info">
        本地费率配置支持后端试算，尚未应用于已有资金订单或真实扣费。
      </Alert>
    </>
  );
}
function AuditPage() {
  const { params, page, change } = useFilters();
  const [keyword, setKeyword] = useState(params.get("keyword") || "");
  const state = useData<Page<Log> & { actions: string[] }>("console/audit", {
    page,
    pageSize: 10,
    keyword: params.get("keyword"),
    action: params.get("action"),
    from: params.get("from"),
    to: params.get("to"),
  });
  return (
    <>
      <PageHeader
        title="操作日志"
        description="追溯用户、开户、费率、密码重置与后台配置操作。时间筛选使用 UTC。"
      />
      <Stack
        component="form"
        direction={{ xs: "column", md: "row" }}
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          change({ keyword });
        }}
      >
        <TextField
          label="操作内容、对象或操作者"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="操作类型"
          value={params.get("action") || ""}
          onChange={(e) => change({ action: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">全部</MenuItem>
          {state.data?.actions.map((a) => (
            <MenuItem key={a} value={a}>
              {actionNames[a] || a}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="date"
          label="开始日期 UTC"
          InputLabelProps={{ shrink: true }}
          value={params.get("from") || ""}
          onChange={(e) => change({ from: e.target.value })}
        />
        <TextField
          type="date"
          label="结束日期 UTC"
          InputLabelProps={{ shrink: true }}
          value={params.get("to") || ""}
          onChange={(e) => change({ to: e.target.value })}
        />
        <Button type="submit" variant="contained">
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            change({ keyword: "", action: "", from: "", to: "" });
          }}
        >
          重置
        </Button>
      </Stack>
      <LoadingError {...state} />
      <GridList
        {...state}
        page={page}
        change={(p) => change({ page: String(p) })}
        href={logHref}
        columns={[
          {
            field: "createdAt",
            headerName: "时间",
            width: 195,
            valueFormatter: (v) => time(v),
          },
          {
            field: "action",
            headerName: "操作类型",
            width: 160,
            valueFormatter: (v) => actionNames[v] || v,
          },
          {
            field: "description",
            headerName: "操作内容",
            minWidth: 280,
            flex: 1,
          },
          { field: "actor", headerName: "操作者", width: 160 },
        ]}
      />
    </>
  );
}
function OrdersPage() {
  const { params, page, change } = useFilters();
  const [keyword, setKeyword] = useState(params.get("keyword") || "");
  const state = useData<Page<Order>>("console/orders", {
    page,
    pageSize: 10,
    keyword: params.get("keyword"),
    currency: params.get("currency"),
    kind: params.get("kind"),
  });
  return (
    <>
      <PageHeader
        title="资金订单"
        description="查询客户端充值、兑换、提现及资金操作订单。与客户端读取相同记录。"
      />
      <Stack
        component="form"
        direction={{ xs: "column", sm: "row" }}
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          change({ keyword });
        }}
      >
        <TextField
          fullWidth
          label="搜索订单号或名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <TextField
          select
          label="币种"
          value={params.get("currency") || ""}
          onChange={(e) => change({ currency: e.target.value })}
          sx={{ minWidth: 120 }}
        >
          {["", "USD", "USDT"].map((c) => (
            <MenuItem key={c} value={c}>
              {c || "全部"}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained">
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            change({ keyword: "", currency: "", kind: "" });
          }}
        >
          重置
        </Button>
      </Stack>
      <LoadingError {...state} />
      <GridList
        {...state}
        page={page}
        change={(p) => change({ page: String(p) })}
        href={(r) => `/finance/orders/${encodeURIComponent(r.id)}`}
        columns={[
          { field: "name", headerName: "订单", flex: 1, minWidth: 180 },
          { field: "kind", headerName: "业务", width: 110 },
          {
            field: "amount",
            headerName: "收支金额",
            width: 195,
            renderCell: (p) => money(p.row.amount, p.row.currency),
          },
          { field: "status", headerName: "状态", width: 150 },
          {
            field: "time",
            headerName: "创建时间",
            width: 195,
            valueFormatter: (v) => time(v),
          },
        ]}
      />
      <Typography variant="caption" color="text.secondary">
        不同币种分别展示；此中心仅查询，不发起或批准真实资金操作。
      </Typography>
    </>
  );
}
function OrderPage({ id }: { id: string }) {
  const state = useData<Order>(`console/orders/${encodeURIComponent(id)}`),
    d = state.data;
  return (
    <>
      <PageHeader
        title="资金订单详情"
        breadcrumbs={[
          { label: "资金订单", to: "/finance/orders" },
          { label: "详情" },
        ]}
      />
      <LoadingError {...state} />
      {d && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack gap={3}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography variant="h6">{d.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {d.kind}
                </Typography>
              </Box>
              <State value={d.status} />
            </Stack>
            <Divider />
            <Typography variant="h4">{money(d.amount, d.currency)}</Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                gap: 3,
              }}
            >
              {[
                ["订单编号", d.orderId],
                ["记录编号", d.id],
                ["创建时间", time(d.time)],
                [
                  "手续费",
                  money(d.finance?.fee, d.finance?.currency || d.currency),
                ],
                [
                  "获得金额",
                  money(
                    d.finance?.receive,
                    d.finance?.toCurrency || d.finance?.currency || d.currency,
                  ),
                ],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography sx={{ overflowWrap: "anywhere" }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
            {d.card && (
              <Button
                sx={{ alignSelf: "flex-start" }}
                component={Link}
                to={`/portal/cards/${d.card.id}`}
              >
                查看客户端卡片 · {d.card.last4}
              </Button>
            )}
          </Stack>
        </Paper>
      )}
    </>
  );
}
function SettingsPage() {
  const state = useData<Settings>("console/settings");
  return (
    <>
      <PageHeader
        title="后台设置"
        description="维护本地总后台的展示名称与首页公告。"
      />
      <LoadingError {...state} />
      {state.data && (
        <SettingsForm
          key={state.data.revision}
          data={state.data}
          reload={state.reload}
        />
      )}
    </>
  );
}
function SettingsForm({
  data,
  reload,
}: {
  data: Settings;
  reload: () => void;
}) {
  const [name, setName] = useState(data.workspaceName),
    [notice, setNotice] = useState(data.notice),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 850 }}>
      <Stack
        component="form"
        gap={3}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post("console/settings", {
              workspaceName: name,
              notice,
              revision: data.revision,
            });
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={reload}>
                重新读取
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {saved && (
          <Alert
            severity="success"
            action={
              <Button component={Link} to="/workbench" color="inherit">
                查看总览
              </Button>
            }
          >
            已保存；新设置将显示在管理总览。
          </Alert>
        )}
        <TextField
          label="后台名称"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 40 }}
          disabled={saved}
        />
        <TextField
          label="首页公告"
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          multiline
          minRows={4}
          inputProps={{ maxLength: 300 }}
          helperText={`${notice.length}/300 · 仅在管理总览展示，不发送给客户`}
          disabled={saved}
        />
        <Typography variant="body2" color="text.secondary">
          此设置不影响账户权限、资金参数或真实渠道配置。
        </Typography>
        <Stack direction="row" gap={1}>
          <Button
            variant="contained"
            type="submit"
            disabled={
              busy ||
              saved ||
              (name === data.workspaceName && notice === data.notice)
            }
          >
            保存设置
          </Button>
          <Button onClick={reload} disabled={busy}>
            重新读取
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
function SystemPage({ access }: { access: boolean }) {
  const state = useData<System>("console/system"),
    d = state.data;
  const { profile } = useAuth();
  return (
    <>
      <PageHeader
        title={access ? "访问权限" : "渠道与数据"}
        description={
          access
            ? "区分后台登录身份、本地操作权限与客户端个人身份。"
            : "查看当前接入范围和数据来源，不展示或录入渠道密钥。"
        }
        action={
          <Button variant="outlined" onClick={state.reload}>
            重新读取
          </Button>
        }
      />
      <LoadingError {...state} />
      {!access && isSlashDemoMode && <LiveSyncStatus/>}
      {access ? (
        <>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6">当前后台登录</Typography>
            <Typography my={1}>
              {profile?.nickname || profile?.username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              来源角色：
              {profile?.roles?.length ? profile.roles.join("、") : "未提供"}
              。导航入口不会授予新的后台权限。
            </Typography>
          </Paper>
          {d?.roles.map((role) => (
            <Paper key={role.id} variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">{role.label}</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" mt={2}>
                {role.permissions.map((p) => (
                  <Chip key={p} label={p} size="small" variant="outlined" />
                ))}
              </Stack>
            </Paper>
          ))}
          <Alert severity="info">
            本地 operator 会话才能访问管理接口，member
            会话不可管理。这里展示已实现的权限边界；管理员创建、自定义角色和生产权限分配尚未接入。
          </Alert>
        </>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 3,
            }}
          >
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">本地管理存储</Typography>
              <Chip
                sx={{ my: 2 }}
                label={d?.storage === "available" ? "本次读取成功" : "尚未确认"}
                color={d?.storage === "available" ? "success" : "default"}
                variant="outlined"
              />
              <Typography variant="body2">
                检查时间：{time(d?.checkedAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary" mt={1}>
                数据批次：{d?.namespace || "—"} · 迁移版本{" "}
                {d?.migrations.join(" / ") || "—"}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">Slash 模拟来源</Typography>
              <Typography variant="body2" color="text.secondary" my={2}>
                最近采集时间：{time(d?.latestCollectedAt)}
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {d?.sourceRecords.map((r) => (
                  <Chip
                    key={r.kind}
                    variant="outlined"
                    label={`${({ card: "卡片", transaction: "交易", account: "账户", balance: "余额快照", fee: "费用", virtualAccount: "虚拟账户" } as Record<string, string>)[r.kind] || r.kind} ${r.count}`}
                    size="small"
                  />
                ))}
              </Stack>
            </Paper>
          </Box>
          <List>
            {d?.channels.map((c) => (
              <ListItem
                key={c.id}
                sx={{ py: 2, borderBottom: 1, borderColor: "divider", gap: 2 }}
              >
                <ListItemIcon>
                  <Icon icon="solar:server-square-linear" width={24} />
                </ListItemIcon>
                <ListItemText primary={c.name} secondary={c.description} />
                <Chip label={c.mode} size="small" variant="outlined" />
              </ListItem>
            ))}
          </List>
          <Alert severity="info">
            存储读取成功仅代表本地服务可用，不代表真实 Slash API
            或其他上游渠道已连通。
            {!isSlashDemoMode ? "原有运营业务继续通过线上只读 API 查询。" : ""}
          </Alert>
        </>
      )}
    </>
  );
}
