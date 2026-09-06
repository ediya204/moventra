import { useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  minorText,
  originalText,
  postingLabels,
  detailLabels,
  sourceLabel,
  utcTime,
} from "../components/cardTransactionFields";

export type DrawerTransaction = {
  id: string;
  merchant?: string | null;
  merchantData?: {
    description?: string | null;
    categoryCode?: string | null;
    location?: {
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      country?: string | null;
    } | null;
  } | null;
  amountCents?: string | null;
  status?: string;
  detailedStatus?: string;
  cardId?: string;
  cardName?: string | null;
  cardLast4?: string | null;
  date?: string;
  authorizedAt?: string;
  observedAt?: string;
  categoryCode?: string | null;
  memo?: string | null;
  orderId?: string;
  referenceNumber?: string;
  accountId?: string;
  originalCurrency?: {
    code?: string | null;
    amountCents?: string | null;
    conversionRate?: string | null;
  } | null;
  internal?: {
    platform?: string;
    customerId?: string | null;
    customerName?: string | null;
  };
  fetchError?: string;
  issues?: string[];
};
export type DrawerCard = {
  id: string;
  cardName?: string;
  maskedCardNumber?: string;
  internal?: { customerId?: string | null; customerName?: string | null };
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(105px, .8fr) minmax(0, 1.4fr)",
        gap: 2,
        alignItems: "start",
        py: 2,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: "right", overflowWrap: "anywhere", fontSize: 14 }}>
        {children || "—"}
      </Box>
    </Box>
  );
}
export default function TransactionDrawer({
  open,
  transaction,
  card,
  cardWarning,
  loading,
  error,
  onClose,
  onRetry,
  onCard,
}: {
  open: boolean;
  transaction?: DrawerTransaction;
  card?: DrawerCard;
  cardWarning?: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onCard: (id: string) => void;
}) {
  const [tab, setTab] = useState("details"),
    [zone, setZone] = useState("UTC"),
    [notice, setNotice] = useState("");
  const t = transaction;
  const matchingCard = card?.id === t?.cardId ? card : undefined;
  const cardName = matchingCard?.cardName || t?.cardName || '卡片名称未采集';
  const cardLast4 = matchingCard?.maskedCardNumber?.match(/^(?:\*{4}|•{4}) ([0-9]{4})$/)?.[1]
    || (typeof t?.cardLast4 === 'string' && /^[0-9]{4}$/.test(t.cardLast4) ? t.cardLast4 : null);
  const location = t?.merchantData?.location;
  const locationText = [
    location?.city,
    [location?.state, location?.zip].filter(v => v?.trim()).join(' '),
    location?.country,
  ].filter(v => v?.trim()).join(', ') || '—';
  const displayTime = (value?: string) =>
    !value
      ? "—"
      : zone === "UTC"
        ? utcTime(value)
        : Number.isFinite(Date.parse(value))
          ? new Date(value).toLocaleString("zh-CN", { hour12: false })
          : "无效时间";
  const owner =
    t?.internal?.customerName ||
    t?.internal?.customerId ||
    card?.internal?.customerName ||
    card?.internal?.customerId ||
    "未绑定";
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("交易 ID 已复制");
    } catch {
      setNotice("复制失败，请选择交易 ID 手动复制");
    }
  };
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        role: "dialog",
        "aria-modal": true,
        "aria-labelledby": "transaction-drawer-title",
        sx: { width: { xs: "100%", sm: 470 }, maxWidth: "100vw" },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2.5,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          position: "sticky",
          top: 0,
          zIndex: 1,
          bgcolor: "background.paper",
        }}
      >
        <Typography id="transaction-drawer-title" variant="subtitle1">
          卡交易详情
        </Typography>
        <IconButton aria-label="关闭交易详情" onClick={onClose}>
          <Icon icon="solar:close-circle-linear" width={22} />
        </IconButton>
      </Stack>
      {loading ? (
        <Stack gap={2} sx={{ p: 3 }} aria-label="正在读取交易详情">
          <Skeleton variant="circular" width={52} height={52} />
          <Skeleton height={56} />
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} height={50} />
          ))}
        </Stack>
      ) : error ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">{error}</Alert>
          <Button sx={{ mt: 2 }} onClick={onRetry}>
            重新加载
          </Button>
        </Box>
      ) : t ? (
        <>
          <Box sx={{ px: 2.5, pt: 3, pb: 2, bgcolor: "action.hover" }}>
            <Stack alignItems="center" gap={1}>
              <Avatar sx={{ bgcolor: "primary.main", width: 52, height: 52 }}>
                <Icon icon="solar:shop-linear" width={28} />
              </Avatar>
              <Typography
                variant="h5"
                component="h2"
                sx={{
                  textAlign: "center",
                  overflowWrap: "anywhere",
                  maxWidth: "100%",
                }}
              >
                {t.merchant || "商户未提供"}
              </Typography>
              <Typography
                variant="h3"
                sx={{
                  fontVariantNumeric: "tabular-nums",
                  color:
                    t.status === "pending" ? "text.secondary" : "text.primary",
                }}
              >
                {t.amountCents == null ? "—" : minorText(t.amountCents)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                USD · 卡片交易{t.status === "pending" ? " · 待入账金额" : ""}
              </Typography>
            </Stack>
            <Paper variant="outlined" sx={{ mt: 2.5, p: 1.5 }}>
              <Stack
                direction="row"
                alignItems="center"
                gap={1}
                flexWrap="wrap"
              >
                <Typography variant="caption" sx={{ flex: 1 }}>
                  {displayTime(t.date)}
                </Typography>
                <TextField
                  select
                  size="small"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  inputProps={{ "aria-label": "详情时区" }}
                  sx={{ minWidth: 88 }}
                >
                  <MenuItem value="UTC">UTC</MenuItem>
                  <MenuItem value="local">本地</MenuItem>
                </TextField>
                <Chip
                  size="small"
                  label={sourceLabel(t.status, postingLabels)}
                  color={
                    t.status === "pending"
                      ? "warning"
                      : t.status === "failed"
                        ? "error"
                        : "default"
                  }
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t.status === "posted" ? "入账日期" : "来源日期"} ·{" "}
                {zone === "UTC"
                  ? "UTC"
                  : Intl.DateTimeFormat().resolvedOptions().timeZone}
              </Typography>
            </Paper>
          </Box>
          <Tabs
            aria-label="交易详情内容"
            value={tab}
            onChange={(_, value) => setTab(value)}
            sx={{ px: 2.5, borderBottom: 1, borderColor: "divider" }}
          >
            <Tab
              label="详情"
              value="details"
              id="transaction-details-tab"
              aria-controls="transaction-details-panel"
            />
            <Tab
              label="附件"
              value="attachments"
              id="transaction-attachments-tab"
              aria-controls="transaction-attachments-panel"
            />
          </Tabs>
          <Box
            role="tabpanel"
            id={`transaction-${tab}-panel`}
            aria-labelledby={`transaction-${tab}-tab`}
            sx={{ px: 2.5, pb: 3 }}
          >
            {tab === "attachments" ? (
              <Stack
                alignItems="center"
                spacing={1.5}
                sx={{ py: 6, textAlign: "center" }}
              >
                <Icon icon="solar:paperclip-linear" width={32} />
                <Typography variant="subtitle1">附件服务暂未接入</Typography>
                <Typography variant="body2" color="text.secondary">
                  当前接口未提供附件，暂不支持查看或上传。
                </Typography>
              </Stack>
            ) : (
              <>
                <Field label="交易 ID">
                  <Stack
                    direction="row"
                    justifyContent="flex-end"
                    alignItems="flex-start"
                    gap={0.5}
                  >
                    <Tooltip title="复制交易 ID">
                      <IconButton
                        size="small"
                        aria-label="复制交易 ID"
                        onClick={() => void copy(t.id)}
                      >
                        <Icon icon="solar:copy-linear" width={16} />
                      </IconButton>
                    </Tooltip>
                    <Typography
                      variant="body2"
                      sx={{ userSelect: "all", overflowWrap: "anywhere" }}
                    >
                      {t.id}
                    </Typography>
                  </Stack>
                </Field>
                <Field label="所属卡片">
                  {t.cardId ? (
                    <Button
                      size="small"
                      onClick={() => onCard(t.cardId!)}
                      endIcon={<Icon icon="solar:arrow-right-linear" />}
                      sx={{
                        textAlign: "right",
                        justifyContent: "flex-end",
                        p: 0,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cardName} · {cardLast4 ? `•••• ${cardLast4}` : "尾号未采集"}
                    </Button>
                  ) : (
                    "— 未提供卡片关联"
                  )}
                </Field>
                <Field label="所属用户">{owner}</Field>
                {cardWarning && (
                  <Alert severity="info" sx={{ my: 1 }}>
                    {cardWarning}
                  </Alert>
                )}
                <Field label="授权时间">{displayTime(t.authorizedAt)}</Field>
                <Field label="入账时间">
                  {t.status === "posted"
                    ? displayTime(t.date)
                    : t.status === "pending"
                      ? "— 尚未入账"
                      : t.status === "failed"
                        ? "— 入账失败"
                        : "— 入账状态未知"}
                </Field>
                <Field label="详细状态">
                  {sourceLabel(t.detailedStatus, detailLabels)}
                </Field>
                <Field label="商户原始描述 / description">
                  {t.merchantData === undefined ? t.merchant : t.merchantData?.description}
                </Field>
                <Field label="商户类别码 / categoryCode">
                  {t.merchantData === undefined ? t.categoryCode : t.merchantData?.categoryCode}
                </Field>
                <Field label="商户地区">
                  <Tooltip describeChild title={locationText}>
                    <Typography variant="body2" noWrap tabIndex={0}>{locationText}</Typography>
                  </Tooltip>
                </Field>
                <Field label="原币金额">
                  {originalText(t.originalCurrency)}
                </Field>
                <Field label="渠道">{t.internal?.platform || "Slash"}</Field>
                <Divider />
                <Field label="备注">{t.memo ?? "— 备注未采集"}</Field>
                <Accordion
                  disableGutters
                  elevation={0}
                  sx={{ "&:before": { display: "none" } }}
                >
                  <AccordionSummary
                    expandIcon={<Icon icon="solar:alt-arrow-down-linear" />}
                  >
                    <Typography variant="body2">来源与同步信息</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Typography variant="body2">商户采集字段 / merchantData</Typography>
                    <Box component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>
                      {t.merchantData === undefined ? "— 未提供或旧记录未采集" : JSON.stringify(t.merchantData, null, 2)}
                    </Box>
                    <Field label="来源账户 ID">{t.accountId}</Field>
                    <Field label="商户订单号">{t.orderId}</Field>
                    <Field label="参考号">{t.referenceNumber}</Field>
                    <Field label="采集时间">{displayTime(t.observedAt)}</Field>
                    {t.fetchError && (
                      <Alert severity="warning">{t.fetchError}</Alert>
                    )}
                    {t.issues?.map((issue, i) => (
                      <Alert key={i} severity="info" sx={{ mt: 1 }}>
                        {issue}
                      </Alert>
                    ))}
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </Box>
        </>
      ) : null}
      <Snackbar
        open={!!notice}
        message={notice}
        autoHideDuration={2500}
        onClose={() => setNotice("")}
      />
    </Drawer>
  );
}
