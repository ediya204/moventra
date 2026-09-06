import ChannelManagement, { ChannelBinding } from "./ChannelManagement";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Tabs,
  Tab,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { zhCN } from "@mui/x-data-grid/locales";
import { Icon } from "@iconify/react";
import { ManagementAccess } from "../management/ManagementPage";
import { get, post, type Page } from "../../../../packages/shared/src/management/api";
import { PageHeader } from "../../../../packages/shared/src/components/PageHeader";
import { ignoresRowAction } from "../../../../packages/shared/src/portal/rowInteraction";
import { binStatuses, type BinProduct } from "../../../../packages/shared/src/bins/types";
const blank: BinProduct = {
  id: "",
  name: "",
  binPrefix: "",
  network: "Visa",
  currency: "USD",
  platform: "Demo",
  upstreamProductId: "",
  status: "draft",
  maxCards: 50,
  description: "",
  internalNote: "",
  revision: 0,
  issuedCount: 0,
};
export default function BinManagementPage() {
  const { pathname } = useLocation();
  const id = pathname.split("/")[2];
  return (
    <ManagementAccess title="卡BIN管理">
      <Stack gap={3}>
        <Alert severity="info">
          本地卡产品目录 ·
          一个BIN可对应多个产品。上架用于客户端演示开卡；不代表真实渠道已开通或支持该BIN。
        </Alert>
        <Tabs
          value={id === "channels" ? "channels" : "bins"}
          aria-label="卡BIN管理分栏"
        >
          <Tab
            label="卡BIN产品"
            value="bins"
            component={Link}
            to="/card-bins"
          />
          <Tab
            label="渠道管理"
            value="channels"
            component={Link}
            to="/card-bins/channels"
          />
        </Tabs>
        {id === "channels" ? (
          <ChannelManagement id={pathname.split("/")[3]} />
        ) : id ? (
          <ProductDetail key={id} id={id} />
        ) : (
          <ProductList />
        )}
      </Stack>
    </ManagementAccess>
  );
}
function ProductList() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const [data, setData] = useState<Page<BinProduct>>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [keyword, setKeyword] = useState(params.get("keyword") || "");
  const page = Math.max(0, Number(params.get("page")) || 0),
    status = params.get("status") || "";
  const key = params.toString();
  useEffect(() => {
    let live = true;
    setLoading(true);
    get<Page<BinProduct>>("bins", {
      page,
      pageSize: 10,
      status,
      channelId: params.get("channelId"),
      keyword: params.get("keyword"),
    })
      .then((d) => {
        if (live) {
          setData(d);
          setError("");
        }
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
  }, [key]);
  const change = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.delete("page");
    v ? p.set(k, v) : p.delete(k);
    setParams(p);
  };
  const columns: GridColDef[] = [
    { field: "name", headerName: "卡产品", minWidth: 210, flex: 1 },
    { field: "binPrefix", headerName: "BIN前缀", width: 125 },
    { field: "network", headerName: "卡组织", width: 140 },
    {
      field: "channelName",
      headerName: "发卡渠道",
      width: 160,
      valueGetter: (v) => v || "未关联 / 本地演示",
    },
    { field: "currency", headerName: "币种", width: 85 },
    {
      field: "status",
      headerName: "状态",
      width: 125,
      renderCell: (p) => (
        <Chip
          size="small"
          variant="outlined"
          color={p.value === "active" ? "success" : p.value === "paused" ? "warning" : p.value === "draft" ? "info" : "default"}
          label={binStatuses[p.value] || p.value}
        />
      ),
    },
    {
      field: "issuedCount",
      headerName: "已开 / 限制",
      width: 120,
      renderCell: (p) => `${p.row.issuedCount} / ${p.row.maxCards}`,
    },
    {
      field: "detail",
      headerName: "操作",
      width: 105,
      renderCell: (p) => (
        <Button component={Link} to={`/card-bins/${p.id}`}>
          维护详情
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="卡BIN管理"
        description="维护产品可售状态、发行标识与开卡规则。暂停产品不影响已经创建的卡片。"
        action={
          <Button
            component={Link}
            to="/card-bins/new"
            variant="contained"
            startIcon={<Icon icon="solar:add-circle-linear" />}
          >
            新增卡产品
          </Button>
        }
      />
      <Stack
        component="form"
        direction={{ xs: "column", sm: "row" }}
        gap={1}
        onSubmit={(e) => {
          e.preventDefault();
          change("keyword", keyword);
        }}
      >
        <TextField
          label="产品名、BIN或产品编号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="状态"
          value={status}
          onChange={(e) => change("status", e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">未归档产品</MenuItem>
          {Object.entries(binStatuses).map(([s, label]) => (
            <MenuItem key={s} value={s}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" type="submit">
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            setParams({});
          }}
        >
          重置
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined">
        <DataGrid
          autoHeight
          rows={data?.rows || []}
          columns={columns.map((c) => ({ ...c, sortable: false }))}
          loading={loading}
          disableRowSelectionOnClick
          disableColumnFilter
          paginationMode="server"
          rowCount={data?.total || 0}
          paginationModel={{ page, pageSize: 10 }}
          onPaginationModelChange={(m) => change("page", String(m.page))}
          pageSizeOptions={[10]}
          localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
          onRowClick={(r, e) => {
            if (!ignoresRowAction(e)) navigate(`/card-bins/${r.id}`);
          }}
        />
      </Paper>
    </>
  );
}
function ProductDetail({ id }: { id: string }) {
  const [params] = useSearchParams();
  const [data, setData] = useState<BinProduct>(),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (id === "new") {
      setData(
        params.get("channelId")
          ? {
              ...blank,
              channelId: params.get("channelId") || undefined,
              platform: "Slash",
              upstreamProductId: params.get("sourceId") || "",
              binPrefix: params.get("prefix") || "",
              network: "",
            }
          : blank,
      );
      return;
    }
    let live = true;
    get<BinProduct>(`bins/${id}`)
      .then((d) => {
        if (live) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, version]);
  return (
    <>
      <PageHeader
        title={id === "new" ? "新增卡产品" : data?.name || "产品详情"}
        breadcrumbs={[
          { label: "卡BIN管理", to: "/card-bins" },
          { label: id === "new" ? "新建" : "维护详情" },
        ]}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {saved && (
        <Alert severity="success" onClose={() => setSaved(false)}>
          产品配置已保存
        </Alert>
      )}
      {data ? (
        <ProductForm
          key={`${id}-${data.revision}`}
          data={data}
          reload={() => setVersion((v) => v + 1)}
          onSaved={() => setSaved(true)}
        />
      ) : (
        !error && <LinearProgress />
      )}
    </>
  );
}
function ProductForm({
  data,
  reload,
  onSaved,
}: {
  data: BinProduct;
  reload: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(data),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const navigate = useNavigate(),
    locked = data.issuedCount > 0;
  const edit = (key: keyof BinProduct, value: unknown) =>
    setDraft((p) => ({ ...p, [key]: value }));
  return (
    <>
      <Box
        component="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const payload = {
              channelId: draft.channelId || "",
              name: draft.name,
              binPrefix: draft.binPrefix,
              network: draft.network,
              currency: draft.currency,
              platform: draft.platform || "Demo",
              upstreamProductId: draft.upstreamProductId || "",
              status: draft.status,
              maxCards: Number(draft.maxCards),
              description: draft.description,
              internalNote: draft.internalNote || "",
              revision: data.revision,
            };
            const result = await post<BinProduct>(
              data.id ? `bins/${data.id}` : "bins",
              payload,
            );
            onSaved();
            if (!data.id) navigate(`/card-bins/${result.id}`);
            else reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack gap={3}>
          {error && (
            <Alert
              severity="error"
              action={
                <Button onClick={reload} color="inherit">
                  重新读取
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          <Paper variant="outlined" component="section" aria-label="产品状态管理" sx={{p:{xs:2,md:3}}}>
            <Stack gap={2}>
              <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5}>
                <Typography variant="h6">状态管理</Typography>
                <Chip size="small" variant="outlined" color={data.status==='active'?'success':data.status==='paused'?'warning':data.status==='draft'?'info':'default'} label={`当前：${binStatuses[data.status]||`未知状态 · ${data.status}`}`}/>
                {draft.status!==data.status&&<Typography variant="caption" color="warning.dark">状态变更待保存</Typography>}
              </Stack>
              <Stack direction={{xs:'column',sm:'row'}} gap={2} alignItems={{xs:'stretch',sm:'center'}}>
                <TextField label="产品状态" select value={draft.status} disabled={busy||data.status==='archived'} onChange={e=>edit('status',e.target.value)} sx={{minWidth:220}}>
                  {!binStatuses[draft.status]&&<MenuItem value={draft.status} disabled>未知状态 · {draft.status}</MenuItem>}
                  {Object.entries(binStatuses).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}
                </TextField>
                <Typography variant="body2" color="text.secondary" sx={{flex:1}}>
                  {({draft:'不展示在客户端开卡目录，适合配置未完成的产品。',active:'在客户端展示，满足渠道、上游产品和数量限制时可选择开卡。',paused:'客户端仍显示产品，但暂停新开卡；已经创建的卡片不受影响。',archived:'从客户端和默认后台列表移除，归档后不可恢复。已有卡片和记录保留。'} as Record<string,string>)[draft.status]||'请选择已支持的产品状态。'}
                </Typography>
                <Button type="submit" variant="contained" disabled={busy} sx={{whiteSpace:'nowrap'}}>{busy?'正在保存…':'保存产品配置'}</Button>
              </Stack>
              {draft.status==='archived'&&data.status!=='archived'&&<Alert severity="warning">保存后将归档此产品，不能重新上架。若只是临时停用，请选择“暂停开卡”。</Alert>}
              {draft.status==='active'&&draft.openingBlockedReason&&<Alert severity="warning">开卡限制：{draft.openingBlockedReason}。请在下方核对渠道与产品关联，保存时由服务端重新校验。</Alert>}
              <Typography variant="caption" color="text.secondary">此状态管理本站产品的可售与开卡范围，与下方配置一起保存，不修改渠道卡片状态。</Typography>
            </Stack>
          </Paper>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0,1.5fr) minmax(260px,1fr)",
              },
              gap: 3,
            }}
          >
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Stack gap={3}>
                <Typography variant="h6">产品资料</Typography>
                <TextField
                  label="客户端展示名称"
                  required
                  value={draft.name}
                  onChange={(e) => edit("name", e.target.value)}
                  inputProps={{ maxLength: 60 }}
                />
                <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                  <TextField
                    label="BIN前缀"
                    required
                    value={draft.binPrefix}
                    disabled={locked}
                    onChange={(e) => edit("binPrefix", e.target.value)}
                    inputProps={{
                      pattern: "[0-9]{6}([0-9]{2})?",
                      maxLength: 8,
                      inputMode: "numeric",
                    }}
                    helperText="6或8位前缀，不录入完整卡号"
                  />
                  <TextField
                    label="卡组织"
                    select
                    value={draft.network}
                    disabled={locked}
                    onChange={(e) => edit("network", e.target.value)}
                    sx={{ minWidth: 150 }}
                  >
                    {["Visa", "Mastercard"].map((v) => (
                      <MenuItem key={v} value={v}>
                        {v}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="币种"
                    value="USD"
                    disabled
                    sx={{ width: 110 }}
                  />
                </Stack>
                <TextField
                  label="客户端产品说明"
                  multiline
                  rows={3}
                  value={draft.description}
                  onChange={(e) => edit("description", e.target.value)}
                  inputProps={{ maxLength: 300 }}
                />
                <Typography variant="h6">发卡渠道与产品关联</Typography>
                <ChannelBinding draft={draft} edit={edit} locked={locked} />
                <TextField
                  label="平台标识"
                  value={draft.platform || ""}
                  required
                  disabled={locked || Boolean(draft.channelId)}
                  onChange={(e) => edit("platform", e.target.value)}
                  inputProps={{ maxLength: 40 }}
                />
                <TextField
                  label="上游产品参考ID（可选）"
                  value={draft.upstreamProductId || ""}
                  disabled={locked || Boolean(draft.channelId)}
                  onChange={(e) => edit("upstreamProductId", e.target.value)}
                  helperText="绑定渠道后从上游目录选择，不手填BIN作为产品ID"
                  inputProps={{ maxLength: 120 }}
                />
                <TextField
                  label="内部备注"
                  multiline
                  rows={2}
                  value={draft.internalNote || ""}
                  onChange={(e) => edit("internalNote", e.target.value)}
                  helperText="客户端接口不返回内部备注和上游参考ID"
                  inputProps={{ maxLength: 500 }}
                />
              </Stack>
            </Paper>
            <Stack gap={3}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Stack gap={3}>
                  <Typography variant="h6">开卡规则</Typography>
                  <TextField
                    label="本地演示开卡数量上限"
                    type="number"
                    value={draft.maxCards}
                    onChange={(e) => edit("maxCards", e.target.value)}
                    required
                    inputProps={{
                      min: Math.max(1, data.issuedCount),
                      max: 1000,
                      step: 1,
                    }}
                    helperText={`已创建 ${data.issuedCount} 张，按产品累计`}
                  />
                  {locked && (
                    <Alert severity="info">
                      已有卡片，发行标识已锁定；产品名称和说明仍可维护。历史卡片保留开卡快照。
                    </Alert>
                  )}
                  <Button type="submit" variant="contained" disabled={busy}>
                    {busy ? "正在保存…" : "保存产品配置"}
                  </Button>
                  <Button component={Link} to="/card-bins">
                    返回列表
                  </Button>
                </Stack>
              </Paper>
              <Alert severity="info">
                当前仅支持 USD
                虚拟卡本地演示。开卡不会扣费，不代表真实平台已成功发卡。
              </Alert>
              {data.id && (
                <Button
                  component={Link}
                  to={`/portal/cards?productId=${data.id}`}
                >
                  查看客户端关联卡片
                </Button>
              )}
            </Stack>
          </Box>
        </Stack>
      </Box>
      {data.audit && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" mb={2}>
            维护记录
          </Typography>
          {data.audit.length ? (
            data.audit.map((a, i) => (
              <Box key={i} py={1}>
                <Typography variant="body2">{a.description}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {a.created_at}
                </Typography>
              </Box>
            ))
          ) : (
            <Typography color="text.secondary">暂无人工维护记录</Typography>
          )}
        </Paper>
      )}
    </>
  );
}
