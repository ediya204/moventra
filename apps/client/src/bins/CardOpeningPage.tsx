import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Radio,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { readPortal } from "../portal/unifiedApi";
import type { Action, State } from "../portal/model";
import type { Page } from "../../../../packages/shared/src/management/api";
import type { BinProduct } from "../../../../packages/shared/src/bins/types";
export function CardOpeningPage({
  state,
  onAction,
}: {
  state: State;
  onAction: (action: Action) => Promise<string>;
}) {
  const [data, setData] = useState<Page<BinProduct>>(),
    [selected, setSelected] = useState<BinProduct>(),
    [keyword, setKeyword] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (!state.unified) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    readPortal<Page<BinProduct>>("bin-products", {
      keyword: search,
      page,
      pageSize: 6,
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
  }, [search, page, refresh, state.unified]);
  if (!state.unified)
    return (
      <Alert severity="info">
        卡产品选择需要本地服务，请在本地 Demo 模式启动后使用。
      </Alert>
    );
  return (
    <Stack gap={3}>
      <Alert severity="info">
        本地演示 ·
        产品来源以所选卡产品为准；此页面仅生成零余额模拟卡，演示开卡免费。
      </Alert>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1.4fr) minmax(300px,1fr)",
          },
          gap: 3,
        }}
      >
        <Box>
          <Stack
            component="form"
            direction="row"
            gap={1}
            mb={2}
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(keyword);
              setPage(0);
            }}
          >
            <TextField
              label="搜索产品或BIN"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              fullWidth
            />
            <Button type="submit" variant="outlined">
              查询
            </Button>
          </Stack>
          {loading && <LinearProgress />}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack role="radiogroup" aria-label="选择卡BIN产品" gap={2}>
            {data?.rows.map((p) => {
              const disabled = p.status !== "active" || !p.remaining || Boolean(p.openingBlockedReason);
              return (
                <Paper
                  key={p.id}
                  variant="outlined"
                  component="label"
                  sx={{
                    p: 2.5,
                    display: "flex",
                    gap: 1.5,
                    alignItems: "flex-start",
                    cursor: disabled ? "not-allowed" : "pointer",
                    borderColor:
                      selected?.id === p.id ? "primary.main" : "divider",
                    bgcolor:
                      selected?.id === p.id
                        ? "primary.lighter"
                        : "background.paper",
                  }}
                >
                  <Radio
                    checked={selected?.id === p.id}
                    disabled={disabled || busy}
                    onChange={() => setSelected(p)}
                    value={p.id}
                    name="product"
                    inputProps={{
                      "aria-label": `${p.name} BIN ${p.binPrefix}`,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      gap={1}
                      alignItems="center"
                    >
                      <Typography variant="subtitle1">{p.name}</Typography>
                      <Chip
                        label={
                          p.openingBlockedReason ? p.openingBlockedReason : p.status === "paused"
                            ? "暂停开卡"
                            : !p.remaining
                              ? "名额已满"
                              : p.network
                        }
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="body2" color="primary.dark" my={1}>
                      BIN {p.binPrefix} · {p.currency} · 虚拟卡
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {p.description || "暂无补充说明"}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      mt={1}
                    >
                      本地剩余开卡名额 {p.remaining}
                    </Typography>
                  </Box>
                </Paper>
              );
            })}
          </Stack>
          {data?.total === 0 && (
            <Typography py={4} color="text.secondary">
              没有符合条件的可展示产品，请调整搜索或联系管理员上架。
            </Typography>
          )}
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mt={2}
          >
            <Button
              disabled={!page || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Typography variant="caption">
              第 {page + 1} 页 · 共 {data?.total ?? "—"} 个产品
            </Typography>
            <Button
              disabled={loading || !data || (page + 1) * 6 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </Stack>
          <Button
            onClick={() => {
              setSelected(undefined);
              setRefresh((v) => v + 1);
            }}
            disabled={busy}
            startIcon={<Icon icon="solar:refresh-linear" />}
          >
            刷新产品配置
          </Button>
        </Box>
        <Paper variant="outlined" sx={{ p: 3, alignSelf: "start" }}>
          <Stack
            component="form"
            gap={3}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selected) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                const id = await onAction({
                  type: "open",
                  name: String(form.get("name") || ""),
                  productId: selected.id,
                  productRevision: selected.revision,
                });
                navigate(`/portal/cards/${id}`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Typography variant="h6">开卡信息</Typography>
            {selected ? (
              <Box>
                <Typography variant="subtitle2">{selected.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  BIN {selected.binPrefix} · {selected.network} ·{" "}
                  {selected.currency}
                </Typography>
              </Box>
            ) : (
              <Typography color="text.secondary">
                先从左侧选择一款卡产品。
              </Typography>
            )}
            <TextField
              label="卡片名称"
              name="name"
              required
              inputProps={{ maxLength: 60 }}
              helperText="例如：Meta 北美投放"
              disabled={busy}
            />
            <Typography variant="body2" color="text.secondary">
              确认时会重新检查产品状态和剩余名额。产品暂停后，已开的卡片及历史记录保持不变。
            </Typography>
            <Button
              type="submit"
              variant="contained"
              disabled={!selected || busy || loading}
            >
              {busy ? "正在开卡…" : "确认开卡"}
            </Button>
            <Button component={Link} to="/portal/cards" disabled={busy}>
              返回卡片中心
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}
