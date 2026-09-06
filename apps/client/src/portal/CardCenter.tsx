import {detailRowProps} from "../../../../packages/shared/src/portal/rowInteraction";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
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
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  asset,
  type Card,
  type Entry,
  type State,
  type FinanceAction,
} from "./model";
import {
  cardHref,
  cardRecordTab,
  cardStatus,
  csvCell,
  filterCards,
  LOW_BALANCE,
  pageCards,
  queryError,
  readCardQuery,
  statusLabels,
} from "./cardQuery";
import {UnifiedTransactions,UnifiedTransactionDetail} from "./UnifiedTransactions";
import {readPortal,type TransactionPage} from "./unifiedApi";
import {statusLabels as sourceStatusLabels,money as sourceMoney} from "../../../../packages/shared/src/slash/api";
import { FinancePanel } from "./FinancePanel";
import { RemoteCardCvv } from "./RemoteCardCvv";
const panel = {
  overflow: "hidden",
};
const inner = { p: { xs: 2, md: 3 } };
const recordTabs = [
  ["overview", "概览"],
  ["transactions", "交易记录"],
  ["funds", "资金记录"],
  ["activity", "操作记录"],
];
function CardBadge({ card }: { card: Card }) {
  const value = cardStatus(card);
  return (
    <Chip
      size="small"
      variant="outlined"
      color={
        value === "active" ? "success" : value === "risk" ? "error" : "default"
      }
      label={card.slash ? `${sourceStatusLabels[card.slash.source.status||'']||'未知状态'} · ${card.slash.source.status||'—'}${card.frozen&&card.slash.source.status==='active'?' · 内部已冻结':''}` : statusLabels[value]}
    />
  );
}
function RecordBadge({ entry }: { entry: Entry }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={
        entry.status === "已完成"
          ? "success"
          : entry.status === "失败"
            ? "error"
            : "warning"
      }
      label={entry.statusText||entry.status}
    />
  );
}
export function CardCenter({
  state,
  onOperation,
  onFreeze,
  onFinance,
}: {
  state: State;
  onOperation: (operation: string, cardId: string) => void;
  onFreeze: (id: string) => void;
  onFinance: (action: FinanceAction) => string | Promise<string>;
}) {
  const location = useLocation(),
    navigate = useNavigate(),
    params = new URLSearchParams(location.search),
    query = readCardQuery(params);
  const segments = location.pathname.split("/");
  const cardId = segments[3];
  const recordId = ["records","transactions"].includes(segments[4]) ? segments[5] : undefined;
  const card = state.cards.find((c) => c.id === cardId);
  const malformed = Boolean(
    segments[4] && (!recordId || !["records","transactions"].includes(segments[4]) || segments[6]),
  );
  const [advanced, setAdvanced] = useState(
    Boolean(
      query.min || query.max || query.start || query.end || query.platform,
    ),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [menuId, setMenuId] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setSelected([]);
    setAnchor(null);
  }, [
    query.q,
    query.status,
    query.platform,
    query.min,
    query.max,
    query.start,
    query.end,
    query.low,
    location.pathname,
  ]);
  const matching = filterCards(state.cards, query),
    pagination = pageCards(matching, query),
    menuCard = state.cards.find((c) => c.id === menuId),
    confirmCard = state.cards.find((c) => c.id === confirm);
  const matchingIds = matching
    .map((c) => c.id)
    .sort()
    .join("|");
  useEffect(() => {
    const ids = new Set(matchingIds.split("|"));
    setSelected((previous) => previous.filter((id) => ids.has(id)));
  }, [matchingIds]);
  const change = (
    values: Record<string, string>,
    options: { pageReset?: boolean; replace?: boolean } = {},
  ) => {
    const p = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    if (options.pageReset !== false) p.delete("page");
    navigate(`${location.pathname}${p.toString() ? "?" + p : ""}`, {
      replace: options.replace,
    });
  };
  const listHref = cardHref(undefined, params);
  const tab = recordTabs.some(([key]) => key === params.get("tab"))
    ? params.get("tab")!
    : "overview";
  const [cardSummary,setCardSummary]=useState<TransactionPage>();
  useEffect(()=>{let active=true;setCardSummary(undefined);if(state.unified&&cardId)readPortal<TransactionPage>('transactions',{cardId,pageSize:5}).then(d=>{if(active)setCardSummary(d);}).catch(()=>{});return()=>{active=false;};},[cardId,state.revision,state.unified]);
  const related = state.unified ? cardSummary?.rows||[] : state.entries.filter((e) => e.card === cardId),
    record = related.find((e) => e.id === recordId);
  const recordHref = (entry: Entry) => {
    const p = new URLSearchParams(params);
    if (tab === "overview") p.set("tab", cardRecordTab(entry));
    return cardHref(cardId, p, entry.id);
  };
  const detailHref = cardHref(cardId, params);
  const filterSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    change(
      Object.fromEntries(
        ["q", "platform", "productId", "min", "max", "start", "end"].map((key) => [
          key,
          String(d.get(key) || "").trim(),
        ]),
      ),
    );
  };
  const exportCards = () => {
    const rows = selected.length
      ? matching.filter((c) => selected.includes(c.id))
      : matching;
    const csv =
      "\uFEFF" +
      [
        [
          "卡片编号",
          "卡片名称",
          "BIN前缀",
          "卡产品",
          "平台",
          "项目",
          "状态",
          "内部卡预算 USD",
          "开卡日期",
        ],
        ...rows.map((c) => [
          c.id,
          c.name,
          c.binProduct?.binPrefix||"",
          c.binProduct?.name||"",
          c.platform || "未分类",
          c.project || "未分组",
          statusLabels[cardStatus(c)],
          (c.balance / 100).toFixed(2),
          c.createdAt || "",
        ]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "moventra-demo-cards.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`已导出 ${rows.length} 张卡片的演示数据。`);
  };
  const doOperation = (operation: string, id: string) => {
    setAnchor(null);
    onOperation(operation, id);
  };
  const renderRecords = (entries: Entry[]) => (
    <TableContainer>
      <Table sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {["记录 / 商户", "时间", "类型", "金额 / 币种", "状态", ""].map(
              (v, i) => (
                <TableCell key={i}>{v}</TableCell>
              ),
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id} hover {...detailRowProps(()=>navigate(recordHref(e)))}>
              <TableCell>
                <Typography
                  component={Link}
                  to={recordHref(e)}
                  variant="subtitle2"
                  color="primary.dark"
                  sx={{ "&:hover": { textDecoration: "underline" } }}
                >
                  {e.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                >
                  {e.id}
                </Typography>
              </TableCell>
              <TableCell>{e.time}</TableCell>
              <TableCell>{e.kind}</TableCell>
              <TableCell>
                {["冻结", "解冻", "开卡"].includes(e.kind)
                  ? "—"
                  : asset(e.amount, e.currency)}
              </TableCell>
              <TableCell>
                <RecordBadge entry={e} />
              </TableCell>
              <TableCell>
                <Button
                  component={Link}
                  to={recordHref(e)}
                  aria-label={`查看记录 ${e.id}`}
                >
                  详情
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!entries.length && (
            <TableRow>
              <TableCell colSpan={6} sx={{ py: 5, textAlign: "center" }}>
                暂无符合条件的记录。可以调整筛选，或稍后再查看。
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
  const filters = [
    ["q", query.q ? `关键词：${query.q}` : ""],
    ["platform", query.platform ? `平台：${query.platform}` : ""],
    ["min", query.min ? `余额 ≥ ${query.min} USD` : ""],
    ["max", query.max ? `余额 ≤ ${query.max} USD` : ""],
    ["start", query.start ? `开卡起始：${query.start}` : ""],
    ["end", query.end ? `开卡截止：${query.end}` : ""],
    ["low", query.low ? "余额低于 200 USD" : ""],
  ].filter(([, label]) => label);
  const counts = filterCards(state.cards, { ...query, status: "all" });
  const isSelectedPage =
    pagination.rows.length > 0 &&
    pagination.rows.every((c) => selected.includes(c.id));
  const breadcrumbs = (
    <Breadcrumbs aria-label="卡片浏览路径" sx={{ mb: 2 }}>
      <Typography
        component={Link}
        to={listHref}
        color={cardId ? "primary.dark" : "text.secondary"}
        variant="body2"
      >
        卡片中心
      </Typography>
      {card && (
        <Typography
          component={recordId ? Link : "span"}
          to={recordId ? detailHref : undefined}
          variant="body2"
          color={recordId ? "primary.dark" : "text.secondary"}
        >
          {card.name}
        </Typography>
      )}
      {recordId && (
        <Typography variant="body2">
          {record?.orderId ? "资金订单详情" : "记录详情"}
        </Typography>
      )}
    </Breadcrumbs>
  );
  return (
    <Stack gap={3}>
      {message && (
        <Alert severity="success" onClose={() => setMessage("")}>
          {message}
        </Alert>
      )}
      {!cardId ? (
        <>
          <Box>
            <Typography color="text.secondary" variant="body2">
              按卡片归属、状态和内部预算快速定位；点击名称查看单卡记录。
            </Typography>
            <Stack direction="row" gap={3} flexWrap="wrap" mt={2}>
              <Typography variant="body2">
                全部卡片 <strong>{state.cards.length}</strong>
              </Typography>
              <Typography variant="body2">
                筛选结果 <strong>{matching.length}</strong>
              </Typography>
              <Typography variant="body2">
                筛选内部卡预算{" "}
                <strong>
                  {asset(matching.reduce((sum, c) => sum + c.balance, 0))}
                </strong>
              </Typography>
            </Stack>
          </Box>
          <Paper variant="outlined" sx={panel}>
            <Tabs
              value={query.status}
              onChange={(_, value) =>
                change({ status: value === "all" ? "" : value })
              }
              variant="scrollable"
              scrollButtons="auto"
              aria-label="卡片状态"
              sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}
            >
              {Object.entries(statusLabels).map(([key, label]) => (
                <Tab
                  key={key}
                  value={key}
                  label={`${label} ${key === "all" ? counts.length : counts.filter((c) => cardStatus(c) === key).length}`}
                />
              ))}
            </Tabs>
            <Box
              component="form"
              key={["q", "platform", "productId", "min", "max", "start", "end"]
                .map((k) => params.get(k))
                .join("|")}
              onSubmit={filterSubmit}
              sx={inner}
            >
              <Stack direction={{ xs: "column", md: "row" }} gap={2}>
                <TextField
                  name="q"
                  label="卡片名称、BIN、尾号或项目"
                  defaultValue={query.q}
                  sx={{ flex: 1, minWidth: 0 }}
                />
                <TextField name="productId" select label="卡BIN产品" defaultValue={query.productId} sx={{minWidth:{md:190}}}>
                  <MenuItem value="">全部产品</MenuItem>
                  {Array.from(new Map(state.cards.filter(c=>c.binProduct).map(c=>[c.binProduct!.id,c.binProduct!])).values()).map(p=><MenuItem key={p.id} value={p.id}>{p.name} · {p.binPrefix}</MenuItem>)}
                  {query.productId&&!state.cards.some(c=>c.binProduct?.id===query.productId)&&<MenuItem value={query.productId}>所选产品 · 暂无卡片</MenuItem>}
                </TextField>
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<Icon icon="solar:magnifer-linear" />}
                >
                  查询
                </Button>
                <Button
                  onClick={() => setAdvanced((v) => !v)}
                  aria-expanded={advanced}
                  aria-controls="card-advanced-filters"
                  endIcon={
                    <Icon
                      icon={
                        advanced
                          ? "solar:alt-arrow-up-linear"
                          : "solar:alt-arrow-down-linear"
                      }
                    />
                  }
                >
                  更多条件
                </Button>
              </Stack>
              <Collapse in={advanced}>
                <Box
                  id="card-advanced-filters"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      sm: "1fr 1fr",
                      xl: "repeat(5,1fr)",
                    },
                    gap: 2,
                    pt: 3,
                  }}
                >
                  <TextField
                    name="platform"
                    select
                    label="投放平台"
                    defaultValue={query.platform}
                  >
                    <MenuItem value="">全部平台</MenuItem>
                    {Array.from(
                      new Set([
                        ...state.cards.map((c) => c.platform || "未分类"),
                        ...(query.platform ? [query.platform] : []),
                      ]),
                    ).map((p) => (
                      <MenuItem value={p} key={p}>
                        {p}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    name="min"
                    label="最低余额 · USD"
                    defaultValue={query.min}
                    inputProps={{ inputMode: "decimal" }}
                  />
                  <TextField
                    name="max"
                    label="最高余额 · USD"
                    defaultValue={query.max}
                    inputProps={{ inputMode: "decimal" }}
                  />
                  <TextField
                    name="start"
                    type="date"
                    label="开卡开始日期"
                    defaultValue={query.start}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    name="end"
                    type="date"
                    label="开卡结束日期"
                    defaultValue={query.end}
                    InputLabelProps={{ shrink: true }}
                  />
                </Box>
              </Collapse>
            </Box>
            <Stack
              direction="row"
              alignItems="center"
              gap={1}
              flexWrap="wrap"
              sx={{ px: 3, pb: 2 }}
            >
              <Chip
                label="低余额 · < 200 USD"
                size="small"
                clickable
                color={query.low ? "warning" : "default"}
                variant={query.low ? "filled" : "outlined"}
                onClick={() => change({ low: query.low ? "" : "1" })}
              />
              {filters
                .filter(([k]) => k !== "low")
                .map(([key, label]) => (
                  <Chip
                    size="small"
                    key={key}
                    label={label}
                    onDelete={() => change({ [key]: "" })}
                  />
                ))}
              {(filters.length > 0 || query.status !== "all") && (
                <Button size="small" onClick={() => navigate("/portal/cards")}>
                  清除全部条件
                </Button>
              )}
            </Stack>
            {queryError(query) && (
              <Alert severity="error" sx={{ mx: 3, mb: 2 }}>
                {queryError(query)}
              </Alert>
            )}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ sm: "center" }}
              gap={2}
              sx={{
                px: 3,
                py: 2,
                borderTop: 1,
                borderColor: "divider",
                bgcolor: "grey.100",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {selected.length
                  ? `已选 ${selected.length} 张卡片`
                  : `共 ${matching.length} 张卡片 · 金额均为 USD`}
              </Typography>
              <Stack direction="row" gap={1}>
                {selected.length > 0 && (
                  <Button onClick={() => setSelected([])}>取消选择</Button>
                )}
                <Button
                  disabled={!matching.length}
                  onClick={exportCards}
                  startIcon={<Icon icon="solar:download-linear" />}
                >
                  {selected.length ? "导出所选" : "导出筛选结果"}
                </Button>
              </Stack>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: "block", lg: "none" }, px: 3, py: 1 }}
            >
              左右滑动查看完整列表，卡片名称保持固定。
            </Typography>
            <TableContainer>
              <Table
                sx={{
                  minWidth: 920,
                  "& .MuiTableCell-root": { px: 1.25 },
                  "& .MuiTableCell-root:nth-of-type(1)": {
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    bgcolor: "background.paper",
                    width: 48,
                    minWidth: 48,
                  },
                  "& .MuiTableCell-root:nth-of-type(2)": {
                    position: "sticky",
                    left: 48,
                    zIndex: 1,
                    bgcolor: "background.paper",
                    minWidth: 160,
                    maxWidth: 185,
                  },
                }}
                aria-label="客户卡片列表"
              >
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={isSelectedPage}
                        indeterminate={
                          pagination.rows.some((c) =>
                            selected.includes(c.id),
                          ) && !isSelectedPage
                        }
                        disabled={!pagination.rows.length}
                        inputProps={{ "aria-label": "选择本页卡片" }}
                        onChange={(_, checked) =>
                          setSelected(
                            checked
                              ? Array.from(
                                  new Set([
                                    ...selected,
                                    ...pagination.rows.map((c) => c.id),
                                  ]),
                                )
                              : selected.filter(
                                  (id) =>
                                    !pagination.rows.some((c) => c.id === id),
                                ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={query.sort === "name"}
                        direction={query.direction}
                        onClick={() =>
                          change({
                            sort: "name",
                            direction:
                              query.sort === "name" && query.direction === "asc"
                                ? "desc"
                                : "asc",
                          })
                        }
                      >
                        卡片名称 / 尾号
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>平台 / 项目</TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={query.sort === "balance"}
                        direction={query.direction}
                        onClick={() =>
                          change({
                            sort: "balance",
                            direction:
                              query.sort === "balance" &&
                              query.direction === "desc"
                                ? "asc"
                                : "desc",
                          })
                        }
                      >
                        内部卡预算
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={query.sort === "created"}
                        direction={query.direction}
                        onClick={() =>
                          change({
                            sort: "created",
                            direction:
                              query.sort === "created" &&
                              query.direction === "desc"
                                ? "asc"
                                : "desc",
                          })
                        }
                      >
                        开卡日期
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagination.rows.map((c) => (
                    <TableRow
                      hover
                      key={c.id}
                      {...detailRowProps(()=>navigate(cardHref(c.id,params)))}
                      selected={selected.includes(c.id)}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selected.includes(c.id)}
                          inputProps={{ "aria-label": `选择 ${c.name}` }}
                          onChange={(_, checked) =>
                            setSelected(
                              checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="subtitle2"
                          component={Link}
                          to={cardHref(c.id, params)}
                          color="primary.dark"
                          sx={{ "&:hover": { textDecoration: "underline" } }}
                        >
                          {c.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                        >
                          •••• {(c.last4||c.id.slice(-4))} · {c.binProduct?`BIN ${c.binProduct.binPrefix}`:"BIN未关联"}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <CardBadge card={c} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {c.platform || "未分类"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {c.project || "未分组"}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="subtitle2">
                          {asset(c.balance)}
                        </Typography>
                        {c.balance < LOW_BALANCE && (
                          <Typography variant="caption" color="warning.dark">
                            低余额
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{c.createdAt || "—"}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        <Button component={Link} to={cardHref(c.id, params)}>
                          详情
                        </Button>
                        <Tooltip title={`更多操作 · ${c.name}`}>
                          <IconButton
                            aria-label={`更多操作 ${c.name}`}
                            aria-haspopup="menu"
                            onClick={(e) => {
                              setAnchor(e.currentTarget);
                              setMenuId(c.id);
                            }}
                          >
                            <Icon icon="solar:menu-dots-bold" width={20} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!pagination.rows.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        sx={{ py: 7, textAlign: "center" }}
                      >
                        <Typography variant="subtitle1">
                          没有找到匹配的卡片
                        </Typography>
                        <Typography
                          color="text.secondary"
                          variant="body2"
                          my={1}
                        >
                          尝试清除状态或余额条件，或使用卡片尾号查找。
                        </Typography>
                        <Button onClick={() => navigate("/portal/cards")}>
                          清除筛选
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={matching.length}
              page={pagination.page - 1}
              rowsPerPage={query.size}
              rowsPerPageOptions={[10, 20, 50]}
              onPageChange={(_, value) =>
                change({ page: String(value + 1) }, { pageReset: false })
              }
              onRowsPerPageChange={(e) => change({ size: e.target.value })}
              labelRowsPerPage="每页"
              labelDisplayedRows={({ from, to, count }) =>
                `${from}–${to} / ${count}`
              }
              getItemAriaLabel={(type) =>
                type === "next"
                  ? "下一页"
                  : type === "previous"
                    ? "上一页"
                    : type === "first"
                      ? "首页"
                      : "末页"
              }
            />
          </Paper>
        </>
      ) : (
        <>
          {!(state.unified&&recordId)&&breadcrumbs}
          {state.unified && card && recordId && !malformed ? <UnifiedTransactionDetail key={recordId} id={decodeURIComponent(recordId)} cardId={cardId} state={state} onFinance={onFinance}/> : !card || malformed || (recordId && !record) ? (
            <Alert
              severity="warning"
              action={
                <Button component={Link} to={listHref}>
                  返回列表
                </Button>
              }
            >
              未找到该卡片或对应记录。请返回列表重新查询。
            </Alert>
          ) : recordId && record ? (
            <>
              {record.orderId ? (
                <FinancePanel
                  key={record.id}
                  state={state}
                  onAction={onFinance}
                  embeddedOrderId={record.orderId}
                  returnTo={detailHref}
                />
              ) : (
                <>
                  <Button
                    component={Link}
                    to={detailHref}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    ← 返回 {card.name}
                  </Button>
                  <Paper variant="outlined" sx={{ ...panel, ...inner }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      gap={2}
                      mb={3}
                    >
                      <Box>
                        <Typography variant="overline" color="text.secondary">
                          {record.kind}详情
                        </Typography>
                        <Typography variant="h5">{record.name}</Typography>
                      </Box>
                      <RecordBadge entry={record} />
                    </Stack>
                    <Typography variant="h4" mb={3}>
                      {["冻结", "解冻", "开卡"].includes(record.kind)
                        ? "操作记录"
                        : asset(record.amount, record.currency)}
                    </Typography>
                    <Box
                      component="dl"
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "140px 1fr" },
                        gap: 2,
                        m: 0,
                      }}
                    >
                      {[
                        ["记录编号", record.id],
                        ["关联卡片", `${card.name} · ${(card.last4||card.id.slice(-4))}`],
                        ["发生时间", record.time],
                        ["业务类型", record.kind],
                        ["当前状态", record.status],
                      ].map(([key, value]) => (
                        <Box key={key} sx={{ display: "contents" }}>
                          <Typography
                            component="dt"
                            color="text.secondary"
                            variant="body2"
                          >
                            {key}
                          </Typography>
                          <Typography
                            component="dd"
                            m={0}
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {value}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    {record.status === "失败" && (
                      <Alert severity="warning" sx={{ mt: 3 }}>
                        演示失败原因：卡片余额不足。检查余额后再处理支付；不要将失败记录视为实际扣款。
                      </Alert>
                    )}
                    <Divider sx={{ my: 3 }} />
                    <Button
                      variant="outlined"
                      component={Link}
                      to={`/portal/support?order=${encodeURIComponent(record.id)}`}
                    >
                      对此记录有疑问
                    </Button>
                  </Paper>
                </>
              )}
            </>
          ) : (
            <>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                gap={2}
              >
                <Box>
                  <Typography variant="h5">{card.name}</Typography>
                  <Typography color="text.secondary" variant="body2" mt={1}>
                    •••• {(card.last4||card.id.slice(-4))} · USD
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mt={1}>
                    {card.binProduct?`${card.binProduct.name} · BIN ${card.binProduct.binPrefix} · ${card.binProduct.network} · 开卡快照 v${card.binProduct.revision}`:"未关联卡BIN产品：缺少可靠来源信息"}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  alignItems="center"
                  gap={1}
                  flexWrap="wrap"
                >
                  <Button component={Link} to={listHref}>
                    返回列表
                  </Button>
                  <Button
                    disabled={card.frozen || card.balanceKind === "managed_ledger"}
                    variant="contained"
                    onClick={() => doOperation("topup", card.id)}
                  >
                    充值到卡
                  </Button>
                  <Button
                    disabled={card.frozen || card.balanceKind === "managed_ledger"}
                    variant="outlined"
                    onClick={() => doOperation("return", card.id)}
                  >
                    转回账户
                  </Button>
                  <Button
                    onClick={() =>
                      card.riskFrozen
                        ? doOperation("ticket", card.id)
                        : setConfirm(card.id)
                    }
                  >
                    {card.riskFrozen
                      ? "申请解除风控"
                      : card.frozen
                        ? "解冻"
                        : "冻结"}
                  </Button>
                </Stack>
              </Stack>
              {card.management && <Alert severity="info">{card.balanceKind==='managed_ledger'?'此卡资金由后台独立账本管理，转入和转出需审批，不使用原演示钱包。 ':''}渠道状态：{card.management.providerStatus}；最近原因：{card.management.reason || '—'}；操作人：{card.management.actor || '—'}；时间：{card.management.operatedAt || '—'}</Alert>}
              {card.frozen && (
                <Alert severity={card.riskFrozen ? "warning" : "info"}>
                  {card.riskFrozen
                    ? "该卡被风控冻结，充值与转回暂不可用。请提交问题，由运营核实后处理。"
                    : "该卡已自助冻结，解冻后可继续充值和转回资金。"}
                </Alert>
              )}
              <Paper variant="outlined" sx={panel}>
                <Tabs
                  value={tab}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="单卡详情分栏"
                  onChange={(_, value) =>
                    change(
                      { tab: value === "overview" ? "" : value },
                      { pageReset: false },
                    )
                  }
                >
                  {recordTabs.map(([key, label]) => (
                    <Tab
                      key={key}
                      value={key}
                      label={
                        key === "overview"
                          ? label
                          : `${label} ${state.unified ? cardSummary?.groupCounts?.[key]??'—' : related.filter((e) => cardRecordTab(e) === key).length}`
                      }
                    />
                  ))}
                </Tabs>
              </Paper>
              {tab === "overview" ? (
                <>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" },
                      gap: 3,
                    }}
                  >
                    <Paper variant="outlined" sx={{ ...panel, ...inner }}>
                      <Typography variant="h6" mb={2}>
                        卡片信息
                      </Typography>
                      {[
                        ["状态", <CardBadge key="badge" card={card} />],
                        ["平台", card.platform || "未分类"],
                        ["项目", card.project || "未分组"],
                        ["开卡日期", card.createdAt || "—"],
                      ].map(([key, value]) => (
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          py={1.5}
                          key={String(key)}
                        >
                          <Typography color="text.secondary" variant="body2">
                            {key}
                          </Typography>
                          <Box>{value}</Box>
                        </Stack>
                      ))}
                      {card.slash ? <Stack gap={1} sx={{mt:2}}><Typography variant="body2">有效期 {card.slash.source.expiryMonth||'—'}/{card.slash.source.expiryYear||'—'}</Typography><Typography variant="body2" sx={{overflowWrap:'anywhere'}}>所属账户 {card.slash.source.accountId||'—'}</Typography><Typography variant="body2">卡组 {card.slash.source.cardGroupName||'—'}</Typography><Typography variant="body2">卡产品 {card.slash.source.cardProductId||'—'}</Typography><Typography variant="body2">消费限额：{card.slash.source.spendingConstraint?.spendingRule?.utilizationLimitV2?.map(l=>`${l.preset} ${sourceMoney(l.limitAmount?.amountCents)}`).join('；')||'—'}</Typography><Alert severity="info">Demo 仅提供后四位，不生成或保存 PAN、CVV。</Alert></Stack> : <RemoteCardCvv key={card.id} />}
                    </Paper>
                    <Paper variant="outlined" sx={{ ...panel, ...inner }}>
                      <Typography color="text.secondary" variant="body2">
                        {card.balanceKind==='managed_ledger'?'独立账本可用资金':'内部卡预算'}
                      </Typography>
                      <Typography variant="h4" my={2}>
                        {asset(card.balance)}
                      </Typography>
                      {card.balance < LOW_BALANCE && (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label="低于 200 USD，建议补充预算"
                        />
                      )}
                      {card.slash&&<Stack gap={1} sx={{mt:2}}><Typography variant="subtitle2">Slash 所属账户 · {card.sourceBalance?.type||'—'}</Typography><Typography>可用 available：{sourceMoney(card.sourceBalance?.available?.amountCents)}</Typography><Typography>已入账 posted：{sourceMoney(card.sourceBalance?.posted?.amountCents)}</Typography><Typography variant="caption">余额时间 {card.sourceBalance?.timestamp||'—'} · 合成来源快照</Typography></Stack>}
                      <Divider sx={{ my: 3 }} />
                      <Typography variant="body2" color="text.secondary">
                        已完成消费（演示记录）
                      </Typography>
                      <Typography variant="h6" mt={1}>
                        {state.unified && !cardSummary ? "—" : asset(
                          state.unified ? cardSummary!.postedSpendCents : related
                            .filter(
                              (e) => e.kind === "消费" && e.status === "已完成",
                            )
                            .reduce((sum, e) => sum + Math.abs(e.amount), 0),
                        )}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                        mt={2}
                      >
                        {card.balanceKind==='managed_ledger'?'按后台已入账双边分录计算，扣除处理中预占；不与原演示钱包或卡预算合并。':'内部卡预算仅记录分配与转回；导入的历史交易不重复扣减预算。来源账户余额独立展示。'}
                      </Typography>
                    </Paper>
                  </Box>
                  <Paper variant="outlined" sx={panel}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      sx={inner}
                    >
                      <Typography variant="h6">最近记录</Typography>
                      <Button
                        onClick={() =>
                          change({ tab: "transactions" }, { pageReset: false })
                        }
                      >
                        查看全部交易
                      </Button>
                    </Stack>
                    {state.unified ? <UnifiedTransactions state={state} cardId={cardId} compact/> : renderRecords(related.slice(0, 5))}
                  </Paper>
                </>
              ) : state.unified ? <UnifiedTransactions key={`${card.id}-${tab}`} state={state} cardId={cardId} group={tab}/> : (
                <CardRecords
                  key={`${card.id}-${tab}`}
                  entries={related.filter((e) => cardRecordTab(e) === tab)}
                  params={params}
                  onChange={(values) => change(values, { pageReset: false })}
                  render={renderRecords}
                />
              )}
            </>
          )}
        </>
      )}
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
      >
        {menuCard && [
          <MenuItem
            key="detail"
            component={Link}
            to={cardHref(menuCard.id, params)}
          >
            查看卡片详情
          </MenuItem>,
          <MenuItem
            key="topup"
            disabled={menuCard.frozen || menuCard.balanceKind === "managed_ledger"}
            onClick={() => doOperation("topup", menuCard.id)}
          >
            充值到卡
          </MenuItem>,
          <MenuItem
            key="return"
            disabled={menuCard.frozen || menuCard.balanceKind === "managed_ledger"}
            onClick={() => doOperation("return", menuCard.id)}
          >
            转回账户
          </MenuItem>,
          <MenuItem
            key="freeze"
            onClick={() => {
              setAnchor(null);
              if (menuCard.riskFrozen) doOperation("ticket", menuCard.id);
              else setConfirm(menuCard.id);
            }}
          >
            {menuCard.riskFrozen
              ? "申请解除风控"
              : menuCard.frozen
                ? "解冻卡片"
                : "冻结卡片"}
          </MenuItem>,
        ]}
      </Menu>
      <Dialog
        open={Boolean(confirmCard)}
        onClose={() => setConfirm("")}
        aria-labelledby="card-freeze-title"
      >
        <DialogTitle id="card-freeze-title">
          {confirmCard?.frozen ? "解冻卡片" : "冻结卡片"}
        </DialogTitle>
        <DialogContent>
          <Typography mb={2}>
            {confirmCard?.name} · •••• {confirmCard?.id.slice(-4)}
          </Typography>
          <Typography color="text.secondary">
            {confirmCard?.frozen
              ? "解冻后将恢复本地演示中的充值和转回操作。"
              : "冻结后将暂停本地演示中的充值和转回操作，可随时自行解冻。"}
            本次不影响真实卡片。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm("")}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (confirmCard) onFreeze(confirmCard.id);
              setConfirm("");
            }}
          >
            确认{confirmCard?.frozen ? "解冻" : "冻结"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
function CardRecords({
  entries,
  params,
  onChange,
  render,
}: {
  entries: Entry[];
  params: URLSearchParams;
  onChange: (values: Record<string, string>) => void;
  render: (entries: Entry[]) => ReactNode;
}) {
  const q = params.get("eq") || "",
    status = ["已完成", "处理中", "失败"].includes(params.get("es") || "")
      ? params.get("es")!
      : "",
    kind = params.get("ek") || "";
  const rows = entries.filter(
    (e) =>
      (!q || `${e.name} ${e.id}`.toLowerCase().includes(q.toLowerCase())) &&
      (!status || e.status === status) &&
      (!kind || e.kind === kind),
  );
  const rawPage = Number(params.get("ep") || 1);
  const recordPage = Math.min(
    Math.max(1, Number.isSafeInteger(rawPage) ? rawPage : 1),
    Math.max(1, Math.ceil(rows.length / 10)),
  );
  return (
    <Paper variant="outlined" sx={panel}>
      <Box
        component="form"
        key={q + status + kind}
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onChange({
            ep: "",
            eq: String(d.get("eq") || ""),
            es: String(d.get("es") || ""),
            ek: String(d.get("ek") || ""),
          });
        }}
        sx={inner}
      >
        <Stack direction={{ xs: "column", md: "row" }} gap={2}>
          <TextField
            name="eq"
            label="商户、名称或记录编号"
            defaultValue={q}
            sx={{ flex: 1 }}
          />
          <TextField
            name="es"
            select
            label="处理状态"
            defaultValue={status}
            sx={{ minWidth: 140 }}
          >
            {["", "已完成", "处理中", "失败"].map((v) => (
              <MenuItem key={v} value={v}>
                {v || "全部状态"}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            name="ek"
            select
            label="业务类型"
            defaultValue={kind}
            sx={{ minWidth: 140 }}
          >
            {Array.from(
              new Set([
                "",
                ...entries.map((e) => e.kind),
                ...(kind ? [kind] : []),
              ]),
            ).map((v) => (
              <MenuItem key={v} value={v}>
                {v || "全部类型"}
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="outlined">
            筛选记录
          </Button>
          <Button onClick={() => onChange({ eq: "", es: "", ek: "", ep: "" })}>
            重置
          </Button>
        </Stack>
      </Box>
      {render(rows.slice((recordPage - 1) * 10, recordPage * 10))}
      <TablePagination
        component="div"
        count={rows.length}
        page={recordPage - 1}
        rowsPerPage={10}
        rowsPerPageOptions={[10]}
        onPageChange={(_, value) => onChange({ ep: String(value + 1) })}
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
        getItemAriaLabel={(type) =>
          type === "next" ? "下一页记录" : "上一页记录"
        }
      />
    </Paper>
  );
}
