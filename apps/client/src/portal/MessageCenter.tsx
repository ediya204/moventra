import { useEffect, useState } from "react";
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
  Checkbox,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Icon } from "@iconify/react";
import type { Action, State } from "./model";
import {
  messageRows,
  messageTypes,
  queryMessages,
  type Message,
  type MessagePage,
} from "./messageQuery";
import { readPortal } from "./unifiedApi";

const icons: Record<string, string> = {
  card: "solar:card-linear",
  funds: "solar:transfer-horizontal-linear",
  system: "solar:bell-linear",
};
const timeText = (time?: string) =>
  time
    ? time
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC")
        .replace(/Z$/, " UTC")
    : "—";
export default function MessageCenter({
  state,
  onAction,
}: {
  state: State;
  onAction: (action: Action) => Promise<string>;
}) {
  const [params, setParams] = useSearchParams(),
    location = useLocation(),
    navigate = useNavigate();
  const detailId = decodeURIComponent(location.pathname.split("/")[3] || "");
  const [data, setData] = useState<MessagePage>(),
    [detail, setDetail] = useState<Message | null>(null),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [keyword, setKeyword] = useState(params.get("keyword") || ""),
    [reload, setReload] = useState(0);
  const status = params.get("status") || "",
    category = params.get("category") || "",
    direction = params.get("direction") || "desc",
    page = Math.max(0, Math.floor(Number(params.get("page")) || 0)),
    pageSize = [10, 20, 50].includes(Number(params.get("pageSize")))
      ? Number(params.get("pageSize"))
      : 10,
    key = params.toString();
  useEffect(() => setKeyword(params.get("keyword") || ""), [key]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    setSelected([]);
    const q = {
      status,
      category,
      direction,
      page,
      pageSize,
      keyword: params.get("keyword") || "",
    };
    (state.unified
      ? readPortal<MessagePage>("messages", q)
      : Promise.resolve(queryMessages(state, q))
    )
      .then((d) => {
        if (live) {
          setData(d);
          const last = Math.max(0, Math.ceil(d.total / pageSize) - 1);
          if (page > last)
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.set("page", String(last));
                return next;
              },
              { replace: true },
            );
        }
      })
      .catch((e) => {
        if (live) {
          setLoadError(e.message);
          setData(undefined);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key, state, reload]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setDetailError("");
    if (!detailId) return;
    setDetailLoading(true);
    (state.unified
      ? readPortal<Message>(`messages/${encodeURIComponent(detailId)}`)
      : Promise.resolve(
          messageRows(state).find((n) => n.id === detailId) || null,
        )
    )
      .then((d) => {
        if (live) {
          setDetail(d);
          if (!d) setDetailError("消息不存在");
        }
      })
      .catch((e) => {
        if (live) setDetailError(e.message);
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [detailId, state, reload]);
  const change = (patch: Record<string, string>) => {
    const q = new URLSearchParams(params);
    q.delete("page");
    for (const [k, v] of Object.entries(patch)) v ? q.set(k, v) : q.delete(k);
    setParams(q);
  };
  const update = async (ids?: string[], read = true) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await onAction({ type: "read", ...(ids ? { ids } : {}), read });
      setFeedback(read ? "已标为已读" : "已标为未读");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (n: Message) => {
    navigate(
      `/portal/messages/${encodeURIComponent(n.id)}${key ? "?" + key : ""}`,
    );
    if (!n.read) void update([n.id]);
  };
  const close = () => navigate(`/portal/messages${key ? "?" + key : ""}`);
  const counts = data?.counts || {
    all: state.notices.length,
    unread: state.notices.filter((n) => !n.read).length,
    read: state.notices.filter((n) => n.read).length,
  };
  const rows = data?.rows || [],
    allSelected = rows.length > 0 && rows.every((n) => selected.includes(n.id));
  return (
    <Stack gap={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        gap={1}
      >
        <Typography color="text.secondary">
          {counts.unread ? (
            <>
              还有{" "}
              <Box
                component="span"
                sx={{ color: "primary.main", fontWeight: 700 }}
              >
                {counts.unread}
              </Box>{" "}
              条未读消息
            </>
          ) : (
            "消息已全部阅读"
          )}{" "}
          · 卡片与资金动态集中查看
        </Typography>
        <Button
          disabled={busy || !counts.unread}
          startIcon={<Icon icon="solar:check-read-linear" />}
          onClick={() => void update()}
        >
          全部标为已读
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {feedback && (
        <Alert severity="success" onClose={() => setFeedback("")}>
          {feedback}
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: detailId ? "minmax(0,1fr) 360px" : "minmax(0,1fr)",
          },
          gap: 2.5,
          alignItems: "start",
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            overflow: "hidden",
            display: { xs: detailId ? "none" : "block", lg: "block" },
          }}
        >
          <Tabs
            value={status}
            onChange={(_, v) => change({ status: v })}
            aria-label="消息阅读状态"
            sx={{ px: 2.5, borderBottom: 1, borderColor: "divider" }}
          >
            {[
              ["", "全部", counts.all],
              ["unread", "未读", counts.unread],
              ["read", "已读", counts.read],
            ].map(([v, label, count]) => (
              <Tab
                key={v}
                value={v}
                label={
                  <Stack direction="row" gap={1} alignItems="center">
                    {label}
                    <Chip size="small" label={count} sx={{ height: 22 }} />
                  </Stack>
                }
              />
            ))}
          </Tabs>
          <Stack
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              change({ keyword: keyword.trim() });
            }}
            direction={{ xs: "column", sm: "row" }}
            gap={1.5}
            sx={{ p: 2.5, flexWrap: "wrap" }}
          >
            <TextField
              size="small"
              label="搜索消息"
              placeholder="主题、内容、卡片或订单编号"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              sx={{ flex: 1, minWidth: 120 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Icon icon="solar:magnifer-linear" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              size="small"
              label="消息类型"
              value={category}
              onChange={(e) => change({ category: e.target.value })}
              sx={{ minWidth: 135 }}
            >
              <MenuItem value="">全部类型</MenuItem>
              {Object.entries(messageTypes).map(([v, label]) => (
                <MenuItem key={v} value={v}>
                  {label}
                </MenuItem>
              ))}
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
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            gap={1}
            px={2.5}
            pb={1.5}
            flexWrap="wrap"
          >
            {selected.length ? (
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="body2">
                  已选 {selected.length} 条
                </Typography>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => void update(selected)}
                >
                  标为已读
                </Button>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => void update(selected, false)}
                >
                  标为未读
                </Button>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                共 {data?.total ?? "—"} 条 · 点击主题查看完整消息
              </Typography>
            )}
            <Button
              size="small"
              startIcon={<Icon icon="solar:sort-by-time-linear" />}
              onClick={() =>
                change({ direction: direction === "desc" ? "asc" : "desc" })
              }
            >
              {direction === "desc" ? "最新消息优先" : "最早消息优先"}
            </Button>
          </Stack>
          {loading && <LinearProgress />}
          {loadError && (
            <Alert
              severity="error"
              action={
                <Button onClick={() => setReload((v) => v + 1)}>重试</Button>
              }
            >
              {loadError}
            </Alert>
          )}
          <TableContainer>
            <Table
              size="small"
              aria-label="消息列表"
              sx={{ tableLayout: "fixed" }}
            >
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={selected.length > 0 && !allSelected}
                      disabled={!rows.length || loading || busy}
                      inputProps={{ "aria-label": "选择本页消息" }}
                      onChange={(_, v) =>
                        setSelected(v ? rows.map((n) => n.id) : [])
                      }
                    />
                  </TableCell>
                  <TableCell>消息主题</TableCell>
                  <TableCell
                    sx={{
                      width: 110,
                      display: { xs: "none", md: "table-cell" },
                    }}
                  >
                    类型
                  </TableCell>
                  <TableCell
                    sx={{
                      width: 160,
                      display: { xs: "none", md: "table-cell" },
                    }}
                  >
                    消息时间
                  </TableCell>
                  <TableCell align="right" sx={{ width: 70 }}>
                    操作
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((n) => (
                  <TableRow
                    key={n.id}
                    hover
                    selected={detailId === n.id}
                    onClick={() => open(n)}
                    sx={{
                      cursor: "pointer",
                      bgcolor: n.read
                        ? undefined
                        : (t) => alpha(t.palette.primary.main, 0.035),
                      "&:last-child td": { border: 0 },
                    }}
                  >
                    <TableCell
                      padding="checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        size="small"
                        checked={selected.includes(n.id)}
                        disabled={busy || loading}
                        inputProps={{ "aria-label": `选择消息 ${n.title}` }}
                        onChange={(_, v) =>
                          setSelected((s) =>
                            v ? [...s, n.id] : s.filter((id) => id !== n.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ py: 2 }}>
                      <Stack direction="row" gap={1.25} alignItems="flex-start">
                        <Box
                          sx={{
                            mt: 0.6,
                            color: n.read ? "text.disabled" : "primary.main",
                            flexShrink: 0,
                          }}
                        >
                          <Icon
                            icon={icons[n.category] || icons.system}
                            width={19}
                          />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" alignItems="center" gap={0.75}>
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                open(n);
                              }}
                              color="inherit"
                              sx={{
                                p: 0,
                                minWidth: 0,
                                textAlign: "left",
                                justifyContent: "flex-start",
                                fontWeight: n.read ? 500 : 700,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {n.title}
                            </Button>
                            {!n.read && (
                              <Box
                                component="span"
                                aria-label="未读"
                                sx={{
                                  width: 6,
                                  height: 6,
                                  bgcolor: "primary.main",
                                  borderRadius: "50%",
                                  flexShrink: 0,
                                }}
                              />
                            )}
                          </Stack>
                          {n.text !== n.title && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                              sx={{ mt: 0.5 }}
                            >
                              {n.text}
                            </Typography>
                          )}
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: { xs: "block", md: "none" },
                              mt: 0.5,
                            }}
                          >
                            {messageTypes[n.category] || "其他消息"} ·{" "}
                            {timeText(n.createdAt)}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={messageTypes[n.category] || "其他消息"}
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        display: { xs: "none", md: "table-cell" },
                        color: "text.secondary",
                        fontSize: 12,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {timeText(n.createdAt)}
                    </TableCell>
                    <TableCell
                      align="right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip title={n.read ? "标为未读" : "标为已读"}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`${n.read ? "标为未读" : "标为已读"} ${n.title}`}
                            disabled={busy || loading}
                            onClick={() => void update([n.id], !n.read)}
                          >
                            <Icon
                              icon={
                                n.read
                                  ? "solar:letter-unread-linear"
                                  : "solar:check-read-linear"
                              }
                              width={20}
                            />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!loading && !loadError && !rows.length && (
            <Stack
              alignItems="center"
              gap={1}
              sx={{ py: 7, px: 3, textAlign: "center" }}
            >
              <Icon icon="solar:inbox-linear" width={36} />
              <Typography variant="subtitle1">
                {status === "unread"
                  ? "当前没有未读消息"
                  : "没有符合条件的消息"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                卡片操作与资金订单更新后，会在这里显示通知。
              </Typography>
              <Button onClick={() => setParams({})}>查看全部消息</Button>
            </Stack>
          )}
          <Divider />
          <TablePagination
            component="div"
            count={data?.total || 0}
            page={page}
            rowsPerPage={pageSize}
            onPageChange={(_, p) => change({ page: String(p) })}
            onRowsPerPageChange={(e) => change({ pageSize: e.target.value })}
            rowsPerPageOptions={[10, 20, 50]}
            labelRowsPerPage="每页"
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} / ${count}`
            }
            getItemAriaLabel={(type) => (type === "next" ? "下一页" : "上一页")}
            sx={{
              ".MuiTablePagination-toolbar": { px: 1, flexWrap: "wrap" },
              ".MuiTablePagination-spacer": { flex: "1 1 0" },
            }}
          />
        </Paper>
        {detailId && (
          <Paper
            variant="outlined"
            component="aside"
            aria-label="消息详情"
            sx={{ p: 3, position: { lg: "sticky" }, top: 24 }}
          >
            <Stack gap={2.5}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="subtitle1">消息详情</Typography>
                <Button
                  size="small"
                  onClick={close}
                  startIcon={<Icon icon="solar:arrow-left-linear" />}
                >
                  返回列表
                </Button>
              </Stack>
              {detailLoading ? (
                <LinearProgress />
              ) : detailError ? (
                <Alert
                  severity="error"
                  action={
                    <Button onClick={() => setReload((v) => v + 1)}>
                      重试
                    </Button>
                  }
                >
                  {detailError}
                </Alert>
              ) : (
                detail && (
                  <>
                    <Stack direction="row" gap={1}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={messageTypes[detail.category] || "其他消息"}
                      />
                      <Chip
                        size="small"
                        color={detail.read ? "default" : "primary"}
                        label={detail.read ? "已读" : "未读"}
                      />
                    </Stack>
                    <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
                      {detail.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {detail.createdAt
                        ? timeText(detail.createdAt)
                        : "历史消息未记录发送时间"}
                    </Typography>
                    <Divider />
                    <Typography
                      sx={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        lineHeight: 1.9,
                      }}
                    >
                      {detail.text}
                    </Typography>
                    {(detail.cardId || detail.orderId) && (
                      <Stack gap={1}>
                        <Typography variant="overline" color="text.secondary">
                          关联业务
                        </Typography>
                        {detail.cardId && (
                          <Button
                            component={Link}
                            to={`/portal/cards/${encodeURIComponent(detail.cardId)}`}
                            variant="outlined"
                            startIcon={<Icon icon="solar:card-linear" />}
                          >
                            查看卡片 · {detail.cardName}
                          </Button>
                        )}
                        {detail.orderId && (
                          <Button
                            component={Link}
                            to={`/portal/funds/orders/${encodeURIComponent(detail.orderId)}`}
                            variant="outlined"
                            startIcon={
                              <Icon icon="solar:document-text-linear" />
                            }
                          >
                            查看{detail.orderName}订单
                          </Button>
                        )}
                      </Stack>
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      消息编号：{detail.id}
                    </Typography>
                    <Button
                      disabled={busy}
                      onClick={() => void update([detail.id], !detail.read)}
                    >
                      {detail.read ? "标为未读" : "标为已读"}
                    </Button>
                  </>
                )
              )}
            </Stack>
          </Paper>
        )}
      </Box>
    </Stack>
  );
}
