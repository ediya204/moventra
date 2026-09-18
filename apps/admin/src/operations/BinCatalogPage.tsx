import { useEffect, useState, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import { useAuth } from "../../../../packages/shared/src/auth/AuthContext";
import { issuingRequest as api } from "../../../../packages/shared/src/issuing/api";
import {
  money,
  toMinor,
  statuses,
  type Product,
  type Supplier,
} from "../../../../packages/shared/src/issuing/contract";
import { PageSkeleton } from "../../../../packages/shared/src/components/AsyncState";
const base = "/admin-api/v1/card-issuing";
type Row = Record<string, unknown>;
function useLoad<T>(path: string, revision: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    api<T>(path)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error };
}
const blankProduct: Product = {
  id: "",
  supplierId: "",
  name: "",
  bin: "",
  network: "",
  upstreamId: "",
  status: "draft",
  description: "",
  feeMinor: "",
  minimumMinor: "",
  revision: 0,
};
const blankSupplier: Supplier = {
  id: "",
  name: "",
  adapter: "manual",
  status: "paused",
  accountRef: "",
  entityRef: "",
  revision: 0,
};
export default function BinCatalogPage() {
  const { ready, authenticated, user, session } = useAuth();
  const location = useLocation();
  if (!ready) return <PageSkeleton />;
  if (!authenticated || !session?.operator || !session.mfaVerified)
    return (
      <Navigate
        to={user ? "/session?security=1" : "/admin/login"}
        state={{ from: location.pathname }}
        replace
      />
    );
  return (
    <DashboardLayout production>
      <Catalog />
    </DashboardLayout>
  );
}
function Catalog() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tail = location.pathname
    .slice("/card-bins".length)
    .split("/")
    .filter(Boolean);
  const section = ["suppliers", "groups", "customers", "audit"].includes(
    tail[0],
  )
    ? tail[0]
    : "products";
  const id = section === "products" ? tail[0] : tail[1];
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4">卡 BIN 管理</Typography>
        <Typography color="text.secondary">
          供应商、产品与客户定价 · USD 虚拟卡
        </Typography>
      </Box>
      <Stack direction="row" gap={1} flexWrap="wrap">
        {[
          ["products", "BIN 产品", "/card-bins"],
          ["suppliers", "供应商", "/card-bins/suppliers"],
          ["groups", "定价组", "/card-bins/groups"],

          ["audit", "维护记录", "/card-bins/audit"],
        ].map(([key, label, to]) => (
          <Button
            key={key}
            component={Link}
            to={to}
            variant={section === key ? "contained" : "outlined"}
          >
            {label}
          </Button>
        ))}
        <Button onClick={refresh}>刷新</Button>
      </Stack>
      {section === "customers" ? (
        <CustomerOps />
      ) : id ? (
        <Editor
          key={location.pathname}
          section={section}
          id={id}
          reload={reload}
          saved={refresh}
        />
      ) : (
        <CatalogList
          section={section}
          params={params}
          setParams={setParams}
          reload={reload}
          navigate={navigate}
        />
      )}
    </Stack>
  );
}
function CatalogList({
  section,
  params,
  setParams,
  reload,
  navigate,
}: {
  section: string;
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
  reload: number;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const page = Number(params.get("page") || 1);
  const path =
    base +
    "/" +
    section +
    "?" +
    new URLSearchParams({
      page: String(page),
      q: params.get("q") || "",
      status: params.get("status") || "",
    });
  const { data, error } = useLoad<Row[]>(path, reload);
  const update = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    p.set(key, value);
    if (key !== "page") p.delete("page");
    setParams(p);
  };
  const prefix =
    section === "products" ? "/card-bins" : "/card-bins/" + section;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
        <TextField
          label={section === "audit" ? "记录资源 ID" : "搜索名称 / BIN"}
          value={params.get("q") || ""}
          onChange={(e) => update("q", e.target.value)}
        />
        {["products", "suppliers"].includes(section) && (
          <TextField
            select
            label="状态"
            value={params.get("status") || ""}
            onChange={(e) => update("status", e.target.value)}
            sx={{ minWidth: 160 }}
          >
            {["", "draft", "active", "paused", "archived"]
              .filter((s) => section !== "suppliers" || s !== "draft")
              .map((s) => (
                <MenuItem key={s} value={s}>
                  {statuses[s] || "全部状态"}
                </MenuItem>
              ))}
          </TextField>
        )}
        {section !== "audit" && (
          <Button variant="contained" onClick={() => navigate(prefix + "/new")}>
            新增
            {section === "products"
              ? " BIN 产品"
              : section === "groups"
                ? "定价组"
                : "供应商"}
          </Button>
        )}
      </Stack>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : !data ? (
        <PageSkeleton />
      ) : !data.length ? (
        <Alert severity="info">当前条件下没有记录。</Alert>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table>
            <TableHead>
              <TableRow>
                {(section === "products"
                  ? [
                      "产品 / BIN",
                      "供应商",
                      "默认开卡费",
                      "最低首充",
                      "状态",
                      "操作",
                    ]
                  : section === "audit"
                    ? ["时间", "操作", "资源", "详情"]
                    : ["名称", "状态 / 版本", "操作"]
                ).map((v) => (
                  <TableCell key={v}>{v}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.slice(0, 50).map((r, i) => (
                <TableRow key={String(r.id || i)}>
                  {section === "products" ? (
                    <>
                      <TableCell>
                        {String(r.name)}
                        <Typography variant="caption" display="block">
                          {String(r.bin)} · {String(r.network || "卡组织待确认")}
                        </Typography>
                      </TableCell>
                      <TableCell>{String(r.supplierName)}</TableCell>
                      <TableCell>{r.feeMinor === "" ? "未配置" : `${money(r.feeMinor)} USD`}</TableCell>
                      <TableCell>{r.minimumMinor === "" ? "未配置" : `${money(r.minimumMinor)} USD`}</TableCell>
                      <TableCell>{statuses[String(r.status)]}</TableCell>
                    </>
                  ) : section === "audit" ? (
                    <>
                      <TableCell>{String(r.createdAt)}</TableCell>
                      <TableCell>{String(r.action)}</TableCell>
                      <TableCell>{String(r.resourceId)}</TableCell>
                      <TableCell>{JSON.stringify(r.detail)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{String(r.name)}</TableCell>
                      <TableCell>
                        {statuses[String(r.status)] || `v${r.revision}`}
                      </TableCell>
                    </>
                  )}
                  {section !== "audit" && (
                    <TableCell>
                      <Button
                        component={Link}
                        to={`${prefix}/${r.id}${location.search}`}
                      >
                        维护详情
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <Stack direction="row" gap={2}>
        <Button
          disabled={page <= 1}
          onClick={() => update("page", String(page - 1))}
        >
          上一页
        </Button>
        <Typography sx={{ alignSelf: "center" }}>
          第 {page} 页 · 每页最多 50 条
        </Typography>
        <Button
          disabled={!data || data.length <= 50}
          onClick={() => update("page", String(page + 1))}
        >
          下一页
        </Button>
      </Stack>
    </Stack>
  );
}
function Editor({
  section,
  id,
  reload,
  saved,
}: {
  section: string;
  id: string;
  reload: number;
  saved: () => void;
}) {
  const isNew = id === "new";
  const { data, error } = useLoad<any>(
    base + "/" + section + (isNew ? "" : "/" + id),
    reload,
  );
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<any>(
    section === "products"
      ? blankProduct
      : section === "suppliers"
        ? blankSupplier
        : { id: "", name: "", revision: 0 },
  );
  useEffect(() => {
    if (!isNew && data) setDraft(section === "products" ? data.product : data);
  }, [data, isNew, section, id]);
  const field = (key: string, label: string, options?: string[]) => (
    <TextField
      key={key}
      label={label}
      value={draft?.[key] ?? ""}
      select={!!options}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      fullWidth
    >
      {options?.map((v) => (
        <MenuItem key={v} value={v}>
          {statuses[v] || v || "未配置"}
        </MenuItem>
      ))}
    </TextField>
  );
  if (!isNew && !data)
    return error ? <Alert severity="error">{error}</Alert> : <PageSkeleton />;
  if (!draft) return <Alert severity="error">记录不存在。</Alert>;
  return (
    <Stack spacing={2}>
      <Button
        sx={{ alignSelf: "start" }}
        component={Link}
        to={
          (section === "products" ? "/card-bins" : "/card-bins/" + section) +
          location.search
        }
      >
        返回列表
      </Button>
      {message && <Alert severity="error">{message}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack
          component="form"
          spacing={2}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            setSuccess("");
            try {
              const v = await api<{ id: string }>(
                base + "/" + section + (isNew ? "" : "/" + id),
                draft,
              );
              setSuccess("已保存，客户端以最新配置为准。");
              if (isNew)
                navigate(
                  (section === "products"
                    ? "/card-bins"
                    : "/card-bins/" + section) +
                    "/" +
                    v.id,
                  { replace: true },
                );
              saved();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Typography variant="h6">
            {isNew ? "新增" : "维护"}
            {section === "products"
              ? " BIN 产品"
              : section === "suppliers"
                ? "供应商"
                : "定价组"}
          </Typography>
          {field("name", "名称")}
          {section === "products" && (
            <>
              {field("supplierId", "供应商 ID（从供应商详情复制）")}
              {field("bin", "BIN 前缀（6 或 8 位）")}
              {field("network", "卡组织", ["", "visa", "mastercard"])}
              {field("upstreamId", "上游产品 ID")}
              {field("status", "产品状态", [
                "draft",
                "active",
                "paused",
                "archived",
              ])}
              <Alert severity="info">
                暂停仅阻止新开卡；归档后不能恢复。产品定价不修改历史订单。
              </Alert>
              {field("description", "客户可见说明")}
              <MoneyField
                label="默认开卡费 · USD"
                value={draft.feeMinor}
                change={(v) => setDraft({ ...draft, feeMinor: v })}
              />
              <MoneyField
                label="最低首充 · USD（须大于零）"
                value={draft.minimumMinor}
                change={(v) => setDraft({ ...draft, minimumMinor: v })}
              />
            </>
          )}
          {section === "suppliers" && (
            <>
              {!isNew && (
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  供应商 ID：{id}
                </Typography>
              )}
              {field("adapter", "渠道适配", ["manual", "slash"])}
              {field("status", "状态", ["active", "paused", "archived"])}
              {field("accountRef", "上游账户 ID")}
              {field("entityRef", "上游主体 ID")}
              <Alert severity="info">
                这里不填写密钥。供应商登记不代表已通过真实发卡验证。
              </Alert>
            </>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={
              busy ||
              (draft.status === "archived" &&
                !isNew &&
                (section === "products"
                  ? data?.product?.status
                  : data?.status) === "archived")
            }
          >
            {busy ? "保存中…" : "保存配置"}
          </Button>
        </Stack>
      </Paper>
      {section === "products" && data?.sources?.map((source: {prefix: string; status: string; observedAt: string; evidenceRef: string}) => (
        <Alert key={source.evidenceRef} severity="info">Slash 来源：{source.prefix} · {source.status === "active" ? "上游可用" : "上游停用"} · 核验时间 {source.observedAt}。上游可用不代表本产品已上架。</Alert>
      ))}
      {section === "products" && !isNew && (
        <PriceEditor
          id={id}
          revision={draft.revision}
          prices={data?.prices || []}
          saved={saved}
        />
      )}
    </Stack>
  );
}
function MoneyField({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
}) {
  const [text, setText] = useState(value === "" ? "" : money(value));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== input.current) setText(value === "" ? "" : money(value));
  }, [value]);
  return (
    <TextField
      inputRef={input}
      label={label}
      value={text}
      error={!!error}
      helperText={error || (value === "" ? "未配置；填写 0 表示免费（仅开卡费）" : "")}
      inputProps={{ inputMode: "decimal" }}
      onChange={(e) => {
        setText(e.target.value);
        try {
          change(e.target.value === "" ? "" : toMinor(e.target.value));
          setError("");
        } catch (e) {
          change("");
          setError((e as Error).message);
        }
      }}
    />
  );
}
function PriceEditor({
  id,
  revision,
  prices,
  saved,
}: {
  id: string;
  revision: number;
  prices: Row[];
  saved: () => void;
}) {
  const [kind, setKind] = useState("customer");
  const [scope, setScope] = useState("");
  const [fee, setFee] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(inherit: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(base + "/prices", {
        productId: id,
        scopeKind: kind,
        scopeId: scope,
        feeMinor: inherit ? null : fee,
        revision,
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">客户与定价组覆盖</Typography>
        <Typography color="text.secondary">
          优先级：客户专属价 → 客户组价 → BIN 默认价。0
          表示免费；恢复继承会删除该层覆盖。
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="覆盖层级"
          select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <MenuItem value="customer">客户</MenuItem>
          <MenuItem value="group">定价组</MenuItem>
        </TextField>
        <TextField
          label={kind === "customer" ? "客户主体 ID" : "定价组 ID"}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
        <MoneyField label="开卡费 · USD" value={fee} change={setFee} />
        <Stack direction="row" gap={2}>
          <Button disabled={busy} onClick={() => save(false)}>
            保存覆盖价
          </Button>
          <Button disabled={busy} onClick={() => save(true)}>
            恢复继承
          </Button>
        </Stack>
        {prices.slice(0, 500).map((p) => (
          <Button
            sx={{ justifyContent: "start", overflowWrap: "anywhere" }}
            key={String(p.scopeKind) + String(p.scopeId)}
            onClick={() => {
              setKind(String(p.scopeKind));
              setScope(String(p.scopeId));
              setFee(String(p.feeMinor));
            }}
          >
            {p.scopeKind === "customer" ? "客户" : "定价组"} {String(p.scopeId)}{" "}
            · {money(p.feeMinor)} USD
          </Button>
        ))}
        {prices.length > 500 && (
          <Alert severity="warning">
            仅显示前 500 项，可输入主体 ID 维护其他价格。
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
function CustomerOps() {
  const [params, setParams] = useSearchParams();
  const customer = params.get("customer") || "";
  const [input, setInput] = useState(customer);
  const [reload, setReload] = useState(0);
  return (
    <Stack spacing={2}>
      <Stack direction="row" gap={2}>
        <TextField
          fullWidth
          label="客户主体 ID"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button onClick={() => setParams({ customer: input })}>查询</Button>
        <Button onClick={() => setReload((n) => n + 1)}>刷新</Button>
      </Stack>
      {/^[0-9a-f-]{36}$/.test(customer) && (
        <CustomerEditor
          key={customer}
          customer={customer}
          reload={reload}
          saved={() => setReload((n) => n + 1)}
        />
      )}
    </Stack>
  );
}
function CustomerEditor({
  customer,
  reload,
  saved,
}: {
  customer: string;
  reload: number;
  saved: () => void;
}) {
  const prefix = `/admin-api/v1/customers/${customer}/card-issuing`;
  const { data, error } = useLoad<any>(prefix + "/enrollment", reload);
  const deposits = useLoad<Row[]>(prefix + "/deposits", reload);
  const orders = useLoad<Row[]>(prefix + "/orders", reload);
  const [draft, setDraft] = useState<any>({});
  const [amount, setAmount] = useState("0");
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data)
      setDraft({
        customerId: customer,
        groupId: data.groupId,
        enabled: data.enabled,
        revision: data.revision,
      });
  }, [data, customer]);
  async function write(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await api(prefix + path, body);
      saved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <PageSkeleton />;
  return (
    <Stack spacing={2}>
      {message && <Alert severity="error">{message}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">{data.name} · 开卡资格</Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={!!draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
            }
            label="允许试点开卡（仍校验客户开户状态及渠道能力）"
          />
          {[
            ["groupId", "定价组 ID（留空使用默认价）"],
          ].map(([k, l]) => (
            <TextField
              key={k}
              label={l}
              value={draft[k] || ""}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          ))}
          <Button disabled={busy} onClick={() => write("/enrollment", draft)}>
            保存资格与定价组
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">真实到账入账申请</Typography>
          <Alert severity="info">
            只能提交已确认到账的凭证；另一名有权限的运营复核后才会入账。
          </Alert>
          <MoneyField
            label="到账金额 · USD"
            value={amount}
            change={setAmount}
          />
          <TextField
            label="唯一到账凭证编号"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <Button
            disabled={busy}
            onClick={() =>
              write("/deposits", { amountMinor: amount, evidenceRef: evidence })
            }
          >
            提交入账复核
          </Button>
          {deposits.error && <Alert severity="error">{deposits.error}</Alert>}
          {deposits.data?.slice(0, 50).map((d) => (
            <Stack
              key={String(d.id)}
              direction="row"
              gap={2}
              alignItems="center"
            >
              <Typography>
                {money(d.amountMinor)} USD · {String(d.evidenceRef)} ·{" "}
                {statuses[String(d.state)]}
              </Typography>
              {d.state === "submitted" && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      write("/deposit-reviews/" + d.id, {
                        revision: d.revision,
                        approve: true,
                      })
                    }
                  >
                    确认到账
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      write("/deposit-reviews/" + d.id, {
                        revision: d.revision,
                        approve: false,
                      })
                    }
                  >
                    拒绝
                  </Button>
                </>
              )}
            </Stack>
          ))}
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">最近开卡订单（最多 50 条）</Typography>
          {orders.error && <Alert severity="error">{orders.error}</Alert>}
          {orders.data?.slice(0, 50).map((o) => (
            <Stack key={String(o.id)} spacing={1}>
              <Typography>
                {String(o.cardName || "卡片名称未生成")} · {String(o.productName)} · {statuses[String(o.state)]} ·{" "}
                {String(o.id)}
              </Typography>
              <Typography variant="body2">
                开卡费 {money(o.feeMinor)} / 首充 {money(o.fundingMinor)} USD
              </Typography>
              {!["active", "failed", "funding_failed"].includes(
                String(o.state),
              ) && (
                <Button
                  disabled={busy || !evidence}
                  onClick={() =>
                    write("/recoveries/" + o.id, { evidenceRef: evidence })
                  }
                >
                  依据上方凭证重新核查（不重新发卡）
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
