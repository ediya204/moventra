import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { get, post, type Page } from "../management/api";
import { PageHeader } from "../components/PageHeader";
import type { BinProduct } from "./types";
export type Channel = {
  id: string;
  name: string;
  provider: string;
  entityRef: string;
  accountRef: string;
  status: string;
  notes: string;
  revision: number;
  total: number;
  linked: number;
  unlinked: number;
  lastImportedAt?: string;
};
type SourceProduct = {
  id: string;
  prefix: string;
  status: string;
  products: { id: string; name: string }[];
};
const blank: Channel = {
  id: "",
  name: "",
  provider: "Slash",
  entityRef: "",
  accountRef: "",
  status: "active",
  notes: "",
  revision: 0,
  total: 0,
  linked: 0,
  unlinked: 0,
};
export default function ChannelManagement({ id }: { id?: string }) {
  return id ? <ChannelDetail key={id} id={id} /> : <ChannelList />;
}
function ChannelList() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const [data, setData] = useState<Page<Channel>>(),
    [error, setError] = useState(""),
    [keyword, setKeyword] = useState(params.get("keyword") || "");
  const page = Number(params.get("page")) || 0,
    key = params.toString();
  useEffect(() => {
    let live = true;
    get<Page<Channel>>("channels", {
      keyword: params.get("keyword"),
      page,
      pageSize: 10,
    })
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
  }, [key]);
  return (
    <Stack gap={2.5}>
      <PageHeader
        title="发卡渠道"
        description="一个渠道维护一份上游目录，再按需关联到客户端卡产品。"
        action={
          <Button
            component={Link}
            to="/card-bins/channels/new"
            variant="contained"
            startIcon={<Icon icon="solar:add-circle-linear" />}
          >
            新增渠道
          </Button>
        }
      />
      <Stack
        component="form"
        direction="row"
        gap={1.5}
        onSubmit={(e) => {
          e.preventDefault();
          setParams(keyword ? { keyword } : {});
        }}
      >
        <TextField
          label="搜索渠道、实体或账户"
          size="small"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button type="submit" variant="contained">
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
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {[
                  "渠道名称",
                  "实体 / 账户范围",
                  "目录产品",
                  "已关联 / 未关联",
                  "状态",
                  "操作",
                ].map((t) => (
                  <TableCell key={t}>{t}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.rows.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => navigate(`/card-bins/channels/${c.id}`)}
                >
                  <TableCell>
                    <Typography variant="subtitle2">{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Slash · 人工目录
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {c.entityRef}
                    <Typography
                      variant="caption"
                      display="block"
                      color="text.secondary"
                    >
                      {c.accountRef || "未配置账户参考"}
                    </Typography>
                  </TableCell>
                  <TableCell>{c.total}</TableCell>
                  <TableCell>
                    {c.linked} / {c.unlinked}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={c.status === "active" ? "本地启用" : "暂停开卡"}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      component={Link}
                      to={`/card-bins/channels/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      查看目录
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!data && !error && <LinearProgress />}
        {data && !data.total && (
          <Stack alignItems="center" gap={1} p={5}>
            <Typography>先创建 Slash 渠道，再登记上游产品</Typography>
            <Typography variant="body2" color="text.secondary">
              例如有8个 BIN，可先关联1个，其余保留在目录中。
            </Typography>
          </Stack>
        )}
        <TablePagination
          component="div"
          count={data?.total || 0}
          page={page}
          rowsPerPage={10}
          rowsPerPageOptions={[10]}
          labelRowsPerPage="每页"
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} / ${count}`
          }
          getItemAriaLabel={(type) => (type === "next" ? "下一页" : "上一页")}
          onPageChange={(_, p) => {
            const q = new URLSearchParams(params);
            q.set("page", String(p));
            setParams(q);
          }}
        />
      </Paper>
    </Stack>
  );
}
function ChannelDetail({ id }: { id: string }) {
  const [data, setData] = useState<Channel>(),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    if (id === "new") {
      setData(blank);
      return;
    }
    get<Channel>(`channels/${id}`)
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
    <Stack gap={2.5}>
      <PageHeader
        title={id === "new" ? "新增 Slash 渠道" : data?.name || "渠道详情"}
        breadcrumbs={[
          { label: "发卡渠道", to: "/card-bins/channels" },
          { label: id === "new" ? "新增" : "渠道详情" },
        ]}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {message && (
        <Alert severity="success" onClose={() => setMessage("")}>
          {message}
        </Alert>
      )}
      {data ? (
        <>
          <ChannelForm
            key={data.revision}
            data={data}
            done={() => {
              setMessage("渠道已保存");
              setVersion((v) => v + 1);
            }}
          />
          {data.id && (
            <SourceCatalog
              channel={data}
              refreshed={(m) => {
                setMessage(m);
                setVersion((v) => v + 1);
              }}
            />
          )}
        </>
      ) : (
        !error && <LinearProgress />
      )}
    </Stack>
  );
}
function ChannelForm({ data, done }: { data: Channel; done: () => void }) {
  const [draft, setDraft] = useState(data),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    navigate = useNavigate();
  const edit = (k: keyof Channel, v: string) =>
    setDraft((p) => ({ ...p, [k]: v }));
  return (
    <Paper
      variant="outlined"
      component="form"
      sx={{ p: 3 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await post<Channel>(
            data.id ? `channels/${data.id}` : "channels",
            {
              name: draft.name,
              provider: "Slash",
              entityRef: draft.entityRef,
              accountRef: draft.accountRef,
              status: draft.status,
              notes: draft.notes,
              revision: data.revision,
            },
          );
          if (data.id) done();
          else navigate(`/card-bins/channels/${result.id}`);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Stack gap={2.5}>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction={{ xs: "column", md: "row" }} gap={2}>
          <TextField
            required
            fullWidth
            label="渠道名称"
            value={draft.name}
            onChange={(e) => edit("name", e.target.value)}
            inputProps={{ maxLength: 60 }}
          />
          <TextField label="平台" value="Slash" disabled />
          <TextField
            select
            label="本地开卡状态"
            value={draft.status}
            onChange={(e) => edit("status", e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="active">启用</MenuItem>
            <MenuItem value="paused">暂停</MenuItem>
          </TextField>
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} gap={2}>
          <TextField
            required
            fullWidth
            label="所属实体参考 ID"
            value={draft.entityRef}
            disabled={data.total > 0}
            onChange={(e) => edit("entityRef", e.target.value)}
            inputProps={{ maxLength: 120 }}
            helperText="用于区分不同实体的产品目录，不验证上游授权"
          />
          <TextField
            fullWidth
            label="账户参考 ID（可选）"
            value={draft.accountRef}
            disabled={data.total > 0}
            onChange={(e) => edit("accountRef", e.target.value)}
            inputProps={{ maxLength: 120 }}
            helperText="仅内部关联；不填写 API Key 或 Secret"
          />
        </Stack>
        <TextField
          label="内部备注"
          value={draft.notes}
          onChange={(e) => edit("notes", e.target.value)}
          multiline
          rows={2}
          inputProps={{ maxLength: 500 }}
        />
        <Alert severity="info">
          当前为人工目录管理，尚未连接真实
          Slash。启用表示允许本地演示；暂停会阻止关联产品继续开卡，已有卡片不受影响。
        </Alert>
        <Stack direction="row" gap={2}>
          <Button type="submit" disabled={busy} variant="contained">
            保存渠道
          </Button>
          <Button component={Link} to="/card-bins/channels">
            返回渠道列表
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
function SourceCatalog({
  channel,
  refreshed,
}: {
  channel: Channel;
  refreshed: (message: string) => void;
}) {
  const [params, setParams] = useSearchParams(),
    [data, setData] = useState<Page<SourceProduct>>(),
    [error, setError] = useState(""),
    [keyword, setKeyword] = useState(params.get("keyword") || "");
  const [json, setJson] = useState(""),
    [preview, setPreview] =
      useState<{ id: string; prefix: string; status: string }[]>(),
    [busy, setBusy] = useState(false);
  const page = Number(params.get("page")) || 0,
    key = params.toString();
  useEffect(() => {
    let live = true;
    get<Page<SourceProduct>>(`channels/${channel.id}/products`, {
      keyword: params.get("keyword"),
      linked: params.get("linked"),
      page,
      pageSize: 10,
    })
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
  }, [channel.id, channel.revision, key]);
  const change = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.delete("page");
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    setParams(p);
  };
  const example = () => {
    setJson(
      JSON.stringify(
        {
          items: Array.from({ length: 8 }, (_, i) => ({
            id: `DEMO-SLASH-PRODUCT-${i + 1}`,
            prefix: `99010${i + 1}`,
            status: "active",
          })),
        },
        null,
        2,
      ),
    );
    setPreview(undefined);
  };
  return (
    <Stack gap={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">上游产品目录</Typography>
        <Typography variant="body2" color="text.secondary">
          共 {channel.total} 个 · 已关联 {channel.linked} · 未关联{" "}
          {channel.unlinked}
        </Typography>
      </Stack>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary
          expandIcon={<Icon icon="solar:alt-arrow-down-linear" />}
        >
          <Stack>
            <Typography variant="subtitle2">导入 / 补充产品目录</Typography>
            <Typography variant="caption" color="text.secondary">
              导入 Slash 产品目录返回值，后续可继续追加其余 BIN
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={2}>
            <Alert severity="info">
              复制 GET /card-product 的
              items（id、prefix、status），每批最多100条。分页响应需逐页导入；未提供的产品不会删除。导入仅登记目录，不自动上架客户端产品。
            </Alert>
            <TextField
              label="产品目录 JSON"
              multiline
              rows={8}
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setPreview(undefined);
              }}
            />
            <Stack direction="row" gap={1} flexWrap="wrap">
              <Button
                onClick={() => {
                  try {
                    const parsed = JSON.parse(json);
                    if (
                      !Array.isArray(parsed.items) ||
                      !parsed.items.length ||
                      parsed.items.length > 100
                    )
                      throw new Error("请输入包含1–100个产品的 items 数组");
                    for (const r of parsed.items)
                      if (
                        !r ||
                        Object.keys(r).some(
                          (k) => !["id", "prefix", "status"].includes(k),
                        ) ||
                        typeof r.id !== "string" ||
                        typeof r.prefix !== "string" ||
                        typeof r.status !== "string"
                      )
                        throw new Error("每条仅包含 id、prefix、status");
                    setPreview(parsed.items);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                    setPreview(undefined);
                  }
                }}
                variant="outlined"
              >
                校验并预览
              </Button>
              <Button onClick={example}>填入8个产品示例</Button>
            </Stack>
            {preview && (
              <>
                <Typography variant="body2">
                  待导入 {preview.length} 个产品（重复 ID
                  更新，未变化的记录保留）
                </Typography>
                <Box sx={{ maxHeight: 200, overflow: "auto" }}>
                  {preview.map((p, i) => (
                    <Typography
                      key={i}
                      variant="body2"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {p.id} · {p.prefix} · {p.status}
                    </Typography>
                  ))}
                </Box>
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await post<{
                        inserted: number;
                        updated: number;
                        unchanged: number;
                      }>(`channels/${channel.id}/import`, {
                        items: preview,
                        revision: channel.revision,
                      });
                      refreshed(
                        `目录导入完成：新增 ${r.inserted}，更新 ${r.updated}，未变 ${r.unchanged}`,
                      );
                      setPreview(undefined);
                      setJson("");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  导入本地目录
                </Button>
              </>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          change({ keyword });
        }}
        direction={{ xs: "column", sm: "row" }}
        gap={1.5}
      >
        <TextField
          label="搜索产品 ID 或 BIN"
          value={keyword}
          size="small"
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          size="small"
          label="关联状态"
          value={params.get("linked") || ""}
          onChange={(e) => change({ linked: e.target.value })}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">全部</MenuItem>
          <MenuItem value="yes">已关联</MenuItem>
          <MenuItem value="no">未关联</MenuItem>
        </TextField>
        <Button type="submit" variant="contained">
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
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {[
                  "上游产品 ID",
                  "prefix / BIN",
                  "来源状态",
                  "客户端产品",
                  "操作",
                ].map((t) => (
                  <TableCell key={t}>{t}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>
                    {p.id}
                  </TableCell>
                  <TableCell>{p.prefix}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={p.status === "active" ? "success" : "warning"}
                      label={
                        p.status === "active"
                          ? "active · 可配置"
                          : `${p.status} · 待确认`
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {p.products.length ? (
                      p.products.map((b) => (
                        <Button
                          key={b.id}
                          component={Link}
                          to={`/card-bins/${b.id}`}
                        >
                          {b.name}
                        </Button>
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        尚未添加
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      disabled={!/^\d{6}(\d{2})?$/.test(p.prefix)}
                      component={Link}
                      to={`/card-bins/new?${new URLSearchParams({ channelId: channel.id, sourceId: p.id, prefix: p.prefix })}`}
                    >
                      {p.products.length ? "新增同源产品" : "添加卡BIN产品"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && !data.total && (
          <Typography p={4} textAlign="center" color="text.secondary">
            暂无符合条件的产品。可先导入目录，或调整筛选条件。
          </Typography>
        )}
        <TablePagination
          component="div"
          count={data?.total || 0}
          page={page}
          rowsPerPage={10}
          rowsPerPageOptions={[10]}
          labelRowsPerPage="每页"
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} / ${count}`
          }
          getItemAriaLabel={(type) => (type === "next" ? "下一页" : "上一页")}
          onPageChange={(_, p) => change({ page: String(p) })}
        />
      </Paper>
      <Typography variant="caption" color="text.secondary">
        只有6或8位 prefix 可用于当前 BIN
        表单。来源状态原样保留，未知状态不能开卡。卡组织与币种需另行核实填写。
      </Typography>
    </Stack>
  );
}
export function ChannelBinding({
  draft,
  edit,
  locked,
}: {
  draft: BinProduct;
  edit: (k: keyof BinProduct, v: unknown) => void;
  locked: boolean;
}) {
  const [channels, setChannels] = useState<Channel[]>([]),
    [channel, setChannel] = useState<Channel | null>(null),
    [products, setProducts] = useState<SourceProduct[]>([]),
    [cq, setCq] = useState(""),
    [pq, setPq] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    get<Page<Channel>>("channels", { keyword: cq, pageSize: 100 })
      .then((d) => {
        if (live) setChannels(d.rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [cq]);
  useEffect(() => {
    let live = true;
    setChannel(null);
    if (draft.channelId)
      get<Channel>(`channels/${draft.channelId}`)
        .then((d) => {
          if (live) setChannel(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [draft.channelId]);
  useEffect(() => {
    let live = true;
    setProducts([]);
    if (draft.channelId)
      get<Page<SourceProduct>>(`channels/${draft.channelId}/products`, {
        keyword: pq,
        pageSize: 100,
      })
        .then((d) => {
          if (live) setProducts(d.rows);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [draft.channelId, pq]);
  return (
    <Stack gap={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Autocomplete
        openText="展开选项"
        closeText="收起选项"
        clearText="清除"
        noOptionsText="没有匹配项，请搜索或先维护目录"
        disabled={locked}
        options={channels}
        value={channel}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        getOptionLabel={(o) => `${o.name} · ${o.entityRef}`}
        filterOptions={(o) => o}
        onInputChange={(_, v, reason) => {
          if (reason === "input") setCq(v);
        }}
        onChange={(_, v) => {
          setChannel(v);
          edit("channelId", v?.id || "");
          edit("platform", v ? "Slash" : "Demo");
          edit("upstreamProductId", "");
          setPq("");
        }}
        renderInput={(p) => (
          <TextField
            {...p}
            label="发卡渠道"
            helperText="搜索并选择已有渠道；同一渠道可关联多个BIN"
          />
        )}
      />
      {draft.channelId ? (
        <>
          <Autocomplete
            openText="展开选项"
            closeText="收起选项"
            clearText="清除"
            noOptionsText="没有匹配项，请搜索或先维护目录"
            disabled={locked}
            options={products}
            value={
              products.find((p) => p.id === draft.upstreamProductId) ||
              (draft.upstreamProductId
                ? {
                    id: draft.upstreamProductId,
                    prefix: draft.binPrefix,
                    status: "",
                    products: [],
                  }
                : null)
            }
            filterOptions={(o) => o}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            getOptionLabel={(p) => `${p.prefix} · ${p.id}`}
            onInputChange={(_, v, reason) => {
              if (reason === "input") setPq(v);
            }}
            onChange={(_, v) => {
              edit("upstreamProductId", v?.id || "");
              if (v) edit("binPrefix", v.prefix);
            }}
            renderInput={(p) => (
              <TextField
                {...p}
                required
                label="上游卡产品"
                helperText="关联 cardProductId；不是卡组 ID。输入 BIN 或 ID 搜索目录。"
              />
            )}
          />
          <Button
            component={Link}
            to={`/card-bins/channels/${draft.channelId}`}
          >
            维护该渠道 / 补充产品目录
          </Button>
        </>
      ) : (
        <Alert severity="info">
          未关联渠道时仅保留独立本地演示。接入 Slash
          产品请先创建渠道并登记目录。
        </Alert>
      )}
      <Button component={Link} to="/card-bins/channels">
        渠道管理
      </Button>
      {draft.openingBlockedReason && (
        <Alert severity="warning">{draft.openingBlockedReason}</Alert>
      )}
    </Stack>
  );
}
