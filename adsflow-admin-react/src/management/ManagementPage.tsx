import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { zhCN } from "@mui/x-data-grid/locales";
import { PageHeader } from "../components/PageHeader";
import { ignoresRowAction } from "../portal/rowInteraction";
import {
  get,
  post,
  decimal,
  exactUnits,
  labels,
  type Fee,
  type Group,
  type User,
  type Page,
  type Audit,
} from "./api";
const local =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  (import.meta.env.DEV || import.meta.env.VITE_DATA_MODE === "slash-demo");
function Status({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={labels[status] || `未知状态 · ${status}`}
      color={
        status === "active"
          ? "success"
          : status === "pending"
            ? "warning"
            : "default"
      }
    />
  );
}
export default function ManagementPage() {
  return (
    <ManagementAccess>
      <ManagementWorkspace />
    </ManagementAccess>
  );
}
export function ManagementAccess({
  children,
  title = "用户组管理",
}: {
  children: ReactNode;
  title?: string;
}) {
  const [ready, setReady] = useState(false),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!local) {
      setChecking(false);
      return;
    }
    let active = true;
    get("session")
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const expired = () => {setReady(false);setChecking(false);};
    window.addEventListener('adsflow:management-session-expired', expired);
    return () => window.removeEventListener('adsflow:management-session-expired', expired);
  }, []);
  if (!local)
    return (
      <Alert severity="info">
        用户组管理当前仅在本地隔离Demo环境启用，尚未连接生产管理接口。
      </Alert>
    );
  if (checking) return <CircularProgress />;
  if (!ready)
    return (
      <Stack gap={3}>
        <PageHeader
          title={title}
          description="管理客户分组、开户、费率与安全操作"
        />
        <Paper variant="outlined" sx={{ p: 4, maxWidth: 640 }}>
          <Stack gap={2}>
            <Typography variant="h6">本地管理演示</Typography>
            <Typography color="text.secondary">
              使用独立的本地管理会话，数据保存到本地Demo数据库。不会修改线上客户，也不会向Slash发送开户或扣费请求。
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Button
              variant="contained"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("session", {
                    username: "demo@adsflow.local",
                    password: "demo-only",
                  });
                  setReady(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              启用本地管理演示
            </Button>
          </Stack>
        </Paper>
      </Stack>
    );
  return <>{children}</>;
}
function ManagementWorkspace() {
  const location = useLocation(),
    navigate = useNavigate();
  const parts = location.pathname.split("/");
  const resource = parts[2] || "groups",
    id = parts[3];
  return (
    <Stack gap={3}>
      <Alert severity="info">
        本地 Demo ·
        开户创建本地零余额账户；费率用于配置与试算，尚未接入生产扣费。密码重置仅作用于本地用户凭证。
      </Alert>
      {resource === "new-user" ? (
        <NewUser />
      ) : id ? (
        <OwnerDetail
          key={`${resource}-${id}`}
          resource={resource === "users" ? "users" : "groups"}
          id={id}
        />
      ) : (
        <>
          <PageHeader
            title="用户组管理"
            description="以用户组统一定价，按用户处理开户与专属配置"
            action={
              <Button
                variant="contained"
                startIcon={<Icon icon="solar:user-plus-linear" />}
                onClick={() => navigate("/user-groups/new-user")}
              >
                新增用户并开户
              </Button>
            }
          />
          <Tabs
            value={resource === "users" ? "users" : "groups"}
            onChange={(_, v) => navigate(`/user-groups/${v}`)}
          >
            <Tab value="groups" label="用户组" />
            <Tab value="users" label="用户与开户" />
          </Tabs>
          <Directory
            key={resource}
            resource={resource === "users" ? "users" : "groups"}
          />
        </>
      )}
    </Stack>
  );
}
function Directory({ resource }: { resource: "groups" | "users" }) {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const [data, setData] = useState<Page<User | Group>>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [keyword, setKeyword] = useState(params.get("keyword") || ""),
    [reload, setReload] = useState(0),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  const query = {
    keyword: params.get("keyword") || "",
    status: params.get("status") || "",
    groupId: params.get("groupId") || "",
    page: Math.max(0, Number(params.get("page")) || 0),
    pageSize: 10,
  };
  const key = JSON.stringify(query);
  useEffect(() => {
    let active = true;
    setLoading(true);
    get<Page<User | Group>>(resource, JSON.parse(key))
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resource, key, reload]);
  const change = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.set("page", "0");
    Object.entries(changes).forEach(([k, v]) =>
      v ? p.set(k, v) : p.delete(k),
    );
    setParams(p);
  };
  const columns: GridColDef[] = [
    {
      field: "name",
      headerName: resource === "users" ? "用户" : "用户组",
      minWidth: 180,
      flex: 1,
    },
    {
      field: resource === "users" ? "email" : "description",
      headerName: resource === "users" ? "邮箱" : "说明",
      minWidth: 220,
      flex: 1,
    },
    ...(resource === "users"
      ? [{ field: "groupName", headerName: "所属用户组", width: 160 }]
      : [{ field: "memberCount", headerName: "成员数", width: 100 }]),
    {
      field: "status",
      headerName: "状态",
      width: 130,
      renderCell: (p) => <Status status={p.value} />,
    },
    { field: "created_at", headerName: "创建时间", width: 215 },
    {
      field: "action",
      headerName: "操作",
      width: 100,
      renderCell: (p) => (
        <Button component={Link} to={`/user-groups/${resource}/${p.id}`}>
          详情
        </Button>
      ),
    },
  ];
  return (
    <Stack gap={2}>
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
          label={
            resource === "users" ? "搜索姓名、邮箱或用户编号" : "搜索用户组"
          }
          size="small"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1 }}
        />
        {resource === "users" && (
          <TextField
            size="small"
            select
            label="状态"
            value={query.status}
            onChange={(e) => change({ status: e.target.value })}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(labels).map(([v, l]) => (
              <MenuItem key={v} value={v}>
                {l}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button variant="contained" type="submit">
          查询
        </Button>
        <Button
          onClick={() => {
            setParams({});
            setKeyword("");
          }}
        >
          重置
        </Button>
        {resource === "groups" && (
          <Button variant="outlined" onClick={() => setCreate(true)}>
            新建用户组
          </Button>
        )}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined">
        <DataGrid
          autoHeight
          rows={data?.rows || []}
          columns={columns.map((c) => ({ ...c, sortable: false }))}
          disableColumnFilter
          disableRowSelectionOnClick
          loading={loading}
          paginationMode="server"
          rowCount={data?.total || 0}
          paginationModel={{ page: query.page, pageSize: 10 }}
          onPaginationModelChange={(m) => change({ page: String(m.page) })}
          pageSizeOptions={[10]}
          localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
          sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
          onRowClick={(r, e) => {
            if (!ignoresRowAction(e))
              navigate(`/user-groups/${resource}/${r.id}`);
          }}
        />
      </Paper>
      <Dialog
        open={create}
        onClose={() => !busy && setCreate(false)}
        fullWidth
        maxWidth="sm"
      >
        <Box
          component="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const result = await post<{ id: string }>("groups", {
                name: d.get("name"),
                description: d.get("description"),
              });
              setCreate(false);
              setReload((v) => v + 1);
              navigate(`/user-groups/groups/${result.id}`);
            } catch (e) {
              setError((e as Error).message);
              setCreate(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogTitle>新建用户组</DialogTitle>
          <DialogContent>
            <Stack gap={2} pt={1}>
              <TextField
                name="name"
                label="用户组名称"
                required
                inputProps={{ maxLength: 60 }}
              />
              <TextField
                name="description"
                label="说明"
                multiline
                rows={2}
                inputProps={{ maxLength: 300 }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreate(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              创建并配置
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  );
}
function NewUser() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    get<Page<Group>>("groups", { pageSize: 100 })
      .then((d) => setGroups(d.rows.filter((g) => g.status === "active")))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader
        title="新增用户并开户"
        breadcrumbs={[
          { label: "用户与开户", to: "/user-groups/users" },
          { label: "新建申请" },
        ]}
        description="先建立用户与组归属，再由管理员审核本地开户申请"
      />
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 800 }}>
        <Box
          component="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const r = await post<{ id: string }>("users", {
                name: d.get("name"),
                email: d.get("email"),
                groupId: d.get("groupId"),
              });
              navigate(`/user-groups/users/${r.id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Stack gap={3}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              name="name"
              label="用户 / 企业名称"
              required
              inputProps={{ maxLength: 80 }}
            />
            <TextField
              name="email"
              label="登录邮箱"
              type="email"
              required
              helperText="本地Demo请使用 example.com 合成邮箱"
            />
            <TextField
              name="groupId"
              label="所属用户组"
              select
              required
              defaultValue=""
            >
              <MenuItem value="" disabled>
                请选择用户组
              </MenuItem>
              {groups.map((g) => (
                <MenuItem value={g.id} key={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>
            <Alert severity="info">
              提交后为“待审核”，不会立即启用。批准后创建本地 USD、USDT
              零余额账户；真实渠道开户与KYC未接入。
            </Alert>
            <Stack direction="row" gap={1}>
              <Button component={Link} to="/user-groups/users">
                取消
              </Button>
              <Button
                variant="contained"
                type="submit"
                disabled={busy || !groups.length}
              >
                提交开户申请
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Paper>
    </>
  );
}
function OwnerDetail({
  resource,
  id,
}: {
  resource: "groups" | "users";
  id: string;
}) {
  const [detailParams] = useSearchParams();
  const [data, setData] = useState<Group & Partial<User>>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState(
      detailParams.get("tab") === "fees" ? "fees" : "overview",
    ),
    [operation, setOperation] = useState(""),
    [busy, setBusy] = useState(false),
    [reset, setReset] = useState<{ token: string; expiresAt: string }>();
  const load = useCallback(
    () => get<Group & Partial<User>>(`${resource}/${id}`).then(setData),
    [resource, id],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const save = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post<{ token?: string; expiresAt?: string }>(
        `${resource}/${id}/${path}`,
        body,
      );
      if (result.token)
        setReset({ token: result.token, expiresAt: result.expiresAt! });
      await load();
      setOperation("");
      setMessage("已保存到本地Demo数据库");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return error ? (
      <Alert severity="error">{error}</Alert>
    ) : (
      <CircularProgress />
    );
  const isUser = resource === "users";
  return (
    <>
      <PageHeader
        title={data.name}
        breadcrumbs={[
          {
            label: isUser ? "用户与开户" : "用户组",
            to: `/user-groups/${resource}`,
          },
          { label: "详情" },
        ]}
        description={isUser ? data.email : data.description}
        action={
          <Stack direction="row" gap={1}>
            <Status status={data.status} />
            {!isUser && (
              <Button component={Link} to={`/user-groups/users?groupId=${id}`}>
                查看成员
              </Button>
            )}
          </Stack>
        }
      />
      {error && <Alert severity="error">{error}</Alert>}
      {message && (
        <Alert severity="success" onClose={() => setMessage("")}>
          {message}
        </Alert>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="overview" label={isUser ? "用户资料与开户" : "分组资料"} />
        <Tab value="fees" label={isUser ? "用户专属费率" : "组默认费率"} />
        <Tab value="audit" label="操作记录" />
      </Tabs>
      {tab === "overview" && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack gap={2.5}>
            <Stack direction="row" gap={3} flexWrap="wrap">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  编号
                </Typography>
                <Typography sx={{ overflowWrap: "anywhere" }}>{id}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  创建时间
                </Typography>
                <Typography>{data.created_at}</Typography>
              </Box>
              {isUser && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    所属用户组
                  </Typography>
                  <Typography>{data.groupName}</Typography>
                </Box>
              )}
            </Stack>
            <Divider />
            {isUser && (
              <>
                <Typography variant="subtitle2">开户与账户</Typography>
                {data.status === "pending" ? (
                  <Alert severity="warning">
                    等待审核。请核对申请资料后批准或拒绝。
                  </Alert>
                ) : data.status === "rejected" ? (
                  <Alert severity="error">
                    开户已拒绝：{data.review_note || "—"}
                  </Alert>
                ) : (
                  <Stack gap={1}>
                    {data.accounts?.map((a) => (
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        key={a.id}
                      >
                        <Typography>{a.currency} 本地账户</Typography>
                        <Typography>
                          可用{" "}
                          {decimal(
                            a.available_minor,
                            a.currency === "USDT" ? 6 : 2,
                          )}{" "}
                          · 已入账{" "}
                          {decimal(
                            a.posted_minor,
                            a.currency === "USDT" ? 6 : 2,
                          )}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </>
            )}
            <Stack direction="row" gap={1} flexWrap="wrap">
              {isUser && data.status === "pending" ? (
                <>
                  <Button
                    variant="contained"
                    onClick={() => setOperation("approve")}
                  >
                    审核通过并开户
                  </Button>
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => setOperation("reject")}
                  >
                    拒绝申请
                  </Button>
                </>
              ) : (
                ["active", "disabled"].includes(data.status) && (
                  <Button
                    variant="outlined"
                    color={data.status === "active" ? "warning" : "primary"}
                    onClick={() =>
                      setOperation(
                        data.status === "active" ? "disable" : "enable",
                      )
                    }
                  >
                    {data.status === "active" ? "停用" : "启用"}
                    {isUser ? "用户" : "用户组"}
                  </Button>
                )
              )}
              <Button onClick={() => setOperation("profile")}>编辑资料</Button>
              {isUser && data.status === "active" && (
                <Button onClick={() => setOperation("reset")}>重置密码</Button>
              )}
            </Stack>
            {isUser && (
              <Typography variant="body2" color="text.secondary">
                密码状态：{data.password_set ? "已设置" : "尚未设置"} · 凭证版本{" "}
                {data.credential_version}。重置完成会使本地旧会话失效。
              </Typography>
            )}
          </Stack>
        </Paper>
      )}
      {tab === "fees" && (
        <FeeEditor
          key={data.revision}
          fees={data.fees || []}
          userId={isUser ? id : undefined}
          busy={busy}
          onSave={(fees) => save("fees", { revision: data.revision, fees })}
        />
      )}
      {tab === "audit" && <AuditList rows={data.audit || []} />}
      <ActionDialog
        key={operation || "none"}
        operation={operation}
        data={data}
        isUser={isUser}
        busy={busy}
        serverError={error}
        close={() => setOperation("")}
        save={save}
      />
      <Dialog
        open={Boolean(reset)}
        onClose={() => setReset(undefined)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>密码重置链接已创建</DialogTitle>
        <DialogContent>
          <Stack gap={2}>
            <Alert severity="info">
              15分钟内有效，仅能使用一次。未发送邮件；关闭后不再展示该链接。
            </Alert>
            <Typography variant="body2">有效期至 {reset?.expiresAt}</Typography>
            <TextField
              multiline
              label="本地重置链接"
              value={
                reset
                  ? `${window.location.origin}/demo-reset-password#${reset.token}`
                  : ""
              }
              InputProps={{ readOnly: true }}
            />
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/demo-reset-password#${reset!.token}`,
                  );
                  setMessage("重置链接已复制");
                } catch {
                  setError("复制失败，请手动复制链接");
                }
              }}
            >
              复制链接
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReset(undefined)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
function ActionDialog({
  operation,
  data,
  isUser,
  busy,
  serverError,
  close,
  save,
}: {
  operation: string;
  data: Group & Partial<User>;
  isUser: boolean;
  busy: boolean;
  serverError: string;
  close: () => void;
  save: (path: string, body: unknown) => Promise<boolean>;
}) {
  const [groups, setGroups] = useState<Group[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (operation === "profile" && isUser)
      get<Page<Group>>("groups", { pageSize: 100 })
        .then((d) => setGroups(d.rows.filter((g) => g.status === "active")))
        .catch((e) => setError(e.message));
  }, [operation, isUser]);
  const titles: Record<string, string> = {
    approve: "审核通过并开户",
    reject: "拒绝开户申请",
    disable: "停用",
    enable: "启用",
    reset: "生成密码重置链接",
    profile: "编辑资料",
  };
  return (
    <Dialog
      open={Boolean(operation)}
      onClose={() => !busy && close()}
      fullWidth
      maxWidth="sm"
    >
      <Box
        component="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget),
            base = { revision: data.revision };
          if (operation === "profile")
            await save("profile", {
              ...base,
              name: d.get("name"),
              ...(isUser
                ? { groupId: d.get("groupId") }
                : { description: d.get("description") }),
            });
          else if (operation === "reset")
            await save("reset-password", { ...base, reason: d.get("reason") });
          else if (["approve", "reject"].includes(operation))
            await save("review", {
              ...base,
              decision: operation,
              reason: d.get("reason"),
            });
          else
            await save("status", {
              ...base,
              status: operation === "enable" ? "active" : "disabled",
              reason: d.get("reason"),
            });
        }}
      >
        <DialogTitle>{titles[operation] || ""}</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            <Typography variant="subtitle2">
              {data.name}
              {data.email ? ` · ${data.email}` : ""}
            </Typography>
            {(error || serverError) && (
              <Alert severity="error">{error || serverError}</Alert>
            )}
            {operation === "profile" ? (
              <>
                <TextField
                  name="name"
                  label="名称"
                  defaultValue={data.name}
                  required
                />
                {isUser ? (
                  <>
                    <TextField
                      name="groupId"
                      select
                      label="所属用户组"
                      defaultValue={data.group_id || ""}
                      required
                    >
                      {groups.map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          {g.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Typography variant="body2" color="text.secondary">
                      调整分组后，继承项目采用新组费率；用户专属配置保持不变。
                    </Typography>
                  </>
                ) : (
                  <TextField
                    name="description"
                    label="说明"
                    defaultValue={data.description || ""}
                    multiline
                    rows={2}
                  />
                )}
              </>
            ) : (
              <>
                <Alert severity={operation === "disable" ? "warning" : "info"}>
                  {operation === "reset"
                    ? "生成一次性链接，由用户设置新密码；旧密码不会显示。未接入邮件发送。"
                    : operation === "approve"
                      ? "批准后启用本地用户并创建USD与USDT零余额账户，不执行真实渠道开户。"
                      : operation === "disable"
                        ? "停用会限制本地用户登录和相关开户操作，不删除历史记录。"
                        : "此操作会记录到审计日志。"}
                </Alert>
                <TextField
                  name="reason"
                  label={
                    operation === "approve" || operation === "reject"
                      ? "审核意见"
                      : "操作原因"
                  }
                  multiline
                  rows={3}
                  required
                  inputProps={{ maxLength: 200 }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button disabled={busy} variant="contained" type="submit">
            {busy ? "正在保存…" : "确认"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
function FeeEditor({
  fees,
  userId,
  busy,
  onSave,
}: {
  fees: Fee[];
  userId?: string;
  busy: boolean;
  onSave: (
    fees: { kind: string; inherit: boolean; bps: number; fixedMinor: number }[],
  ) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() =>
      fees.map((f) => ({
        ...f,
        inherit: !f.overridden,
        rate: decimal(f.bps, 2),
        fixed: decimal(f.fixedMinor, f.precision),
      })),
    ),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState("withdraw"),
    [amount, setAmount] = useState("100"),
    [preview, setPreview] = useState<{
      feeMinor: number;
      currency: string;
      precision: number;
      source: string;
    }>();
  const change = (index: number, patch: Partial<(typeof draft)[number]>) => {
    setDraft((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
    setDirty(true);
    setPreview(undefined);
  };
  return (
    <Stack gap={2}>
      <Typography color="text.secondary">
        {userId
          ? "默认继承所属组的费率，关闭继承后可为该用户单独定价。"
          : "组费率应用于未设置专属费率的成员；勾选默认时使用系统演示值。"}{" "}
        百分比与固定费相加，百分比费用向上取整至最小单位。
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small" sx={{ minWidth: 680 }}>
            <TableHead>
              <TableRow>
                <TableCell>业务</TableCell>
                <TableCell>{userId ? "继承组费率" : "使用默认"}</TableCell>
                <TableCell>费率 %</TableCell>
                <TableCell>固定费</TableCell>
                <TableCell>币种</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {draft.map((f, index) => (
                <TableRow key={f.kind}>
                  <TableCell>{f.label}</TableCell>
                  <TableCell>
                    <Checkbox
                      checked={f.inherit}
                      disabled={busy}
                      inputProps={{ "aria-label": `${f.label}继承费率` }}
                      onChange={(_, checked) =>
                        change(index, { inherit: checked })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={f.rate}
                      disabled={f.inherit || busy}
                      inputProps={{
                        inputMode: "decimal",
                        "aria-label": `${f.label}费率百分比`,
                      }}
                      onChange={(e) => change(index, { rate: e.target.value })}
                      sx={{ width: 115 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={f.fixed}
                      disabled={f.inherit || busy}
                      inputProps={{
                        inputMode: "decimal",
                        "aria-label": `${f.label}固定费`,
                      }}
                      onChange={(e) => change(index, { fixed: e.target.value })}
                      sx={{ width: 150 }}
                    />
                  </TableCell>
                  <TableCell>{f.currency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.secondary">
          {dirty ? "有未保存的修改" : "当前显示已保存的有效费率"}
        </Typography>
        <Button
          variant="contained"
          disabled={busy || !dirty}
          onClick={async () => {
            setError("");
            try {
              const rows = draft.map((f) => ({
                kind: f.kind,
                inherit: f.inherit,
                bps: exactUnits(f.rate, 2),
                fixedMinor: exactUnits(f.fixed, f.precision),
              }));
              if (rows.some((f) => !f.inherit && f.bps > 10000))
                throw new Error("百分比不能超过100%");
              await onSave(rows);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          保存费率
        </Button>
      </Stack>
      {userId && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" mb={2}>
            计费预览
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <TextField
              size="small"
              select
              label="业务类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPreview(undefined);
              }}
              sx={{ minWidth: 170 }}
            >
              {fees.map((f) => (
                <MenuItem key={f.kind} value={f.kind}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={`业务金额 · ${fees.find((f) => f.kind === kind)?.currency}`}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setPreview(undefined);
              }}
            />
            <Button
              disabled={dirty || busy}
              variant="outlined"
              onClick={async () => {
                try {
                  setError("");
                  const f = fees.find((f) => f.kind === kind)!;
                  setPreview(
                    await post("fees/preview", {
                      userId,
                      kind,
                      amountMinor: exactUnits(amount, f.precision),
                    }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              试算已保存费率
            </Button>
          </Stack>
          {preview && (
            <Alert severity="info" sx={{ mt: 2 }}>
              预计手续费 {decimal(preview.feeMinor, preview.precision)}{" "}
              {preview.currency} · 来源：
              {preview.source === "user"
                ? "用户专属"
                : preview.source === "group"
                  ? "所属用户组"
                  : "系统默认"}
              。试算不会扣费。
            </Alert>
          )}
        </Paper>
      )}
    </Stack>
  );
}
function AuditList({ rows }: { rows: Audit[] }) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" mb={2}>
        最近50条操作记录
      </Typography>
      {rows.length ? (
        rows.map((r, i) => (
          <Box key={i} sx={{ py: 2, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
              {r.description}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {r.created_at} · {r.actor} · {r.action}
            </Typography>
          </Box>
        ))
      ) : (
        <Typography color="text.secondary">暂无操作记录</Typography>
      )}
    </Paper>
  );
}
