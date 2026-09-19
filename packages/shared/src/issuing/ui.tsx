import { useEffect, useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import { issuingRequest } from "./api";
import { money, orderStatuses, reasons, type Order } from "./contract";
export function useIssuing<T>(
  path: string,
  revision = 0,
  poll?: (data: T) => boolean,
) {
  const [result, setResult] = useState<{
    path: string;
    data?: T;
    error?: string;
  }>({ path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true,
      reading = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (reading || (typeof document !== "undefined" && document.hidden))
        return;
      reading = true;
      try {
        const data = await issuingRequest<T>(path);
        if (!live) return;
        setResult({ path, data });
        if (poll?.(data)) timer = setTimeout(read, 3000);
      } catch (e) {
        if (live)
          setResult((old) => ({
            path,
            data: old.path === path ? old.data : undefined,
            error: (e as Error).message,
          }));
      } finally {
        reading = false;
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void read();
      }
    };
    void read();
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, revision, tick, poll]);
  return {
    ...(result.path === path ? result : { path }),
    refresh: () => setTick((n) => n + 1),
  };
}
export function orderPending(order: Order) {
  return !["active", "failed", "funding_failed", "review_required"].includes(
    order.state,
  );
}
export function OrderSummary({ order }: { order: Order }) {
  const status =
    order.pilot && order.state === "funding_failed" ? "首充失败 · 待核查" : (orderStatuses as Record<string, string>)[order.state] || order.state;
  const explanation: Record<string, string> = {
    queued: "订单已保存，等待钱包资金预占。",
    reserved: "开卡费和首充已转入订单在途分户。",
    creating: "正在确认发卡结果，请勿重复提交。",
    provider_unknown: "渠道结果待核查，资金暂不退回，请勿重复开卡。",
    created: "已创建卡片，等待确认开卡费记账。",
    fee_charged: "开卡费已收取，正在处理首充。",
    funded: "首充已记入内部卡分户，等待核验渠道限制。",
    enabling: "正在核验启用结果，尚不能确认卡片可用。",
    active: "发卡、费用、首充记账和启用核验均已完成。",
    releasing: "正在退回预占资金，尚未确认退款完成。",
    funding_failed:
      order.pilot ? "开卡费已收取，首充已退回钱包。本次验收不开放补充首充，请联系运营核查。" : "开卡费已收取，首充已退回钱包。可对原卡补充首充，不再收开卡费。",
    review_required: "需要运营核查；当前资金状态保持不变。",
    failed: "本次开卡未完成。未预占或已退回预占金额，详见处理记录。",
  };
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">{status}</Typography>
        <Typography>
          {order.cardName || "卡片名称未生成"} · {order.productName} · BIN{" "}
          {order.bin}
        </Typography>
        <Typography sx={{ overflowWrap: "anywhere" }} variant="body2">
          订单 {order.id}
        </Typography>
        <Typography>
          开卡费 USD {money(order.feeMinor)} · 首充 USD{" "}
          {money(order.fundingMinor)}
        </Typography>
        {order.fundingSource && <Typography variant="body2" color="text.secondary">付款及退款账户：{order.fundingSource === "funds_wallet" ? "资金中心 USD 主钱包" : "原独立开卡钱包"}</Typography>}
        <Alert severity={order.state === "active" ? "success" : "info"}>
          {explanation[order.state] || "状态待核查"}
        </Alert>
        {order.errorCode && (
          <Typography color="text.secondary">
            {reasons[order.errorCode] || "处理中遇到异常，请联系运营核查"}
          </Typography>
        )}
        <Typography variant="subtitle2">处理记录</Typography>
        {order.events?.map((event, index) => (
          <Typography key={index} variant="body2">
            {new Date(event.createdAt).toLocaleString()} ·{" "}
            {(orderStatuses as Record<string, string>)[event.state] ||
              event.state}
          </Typography>
        ))}
        {!order.events?.length && (
          <Typography color="text.secondary">
            订单已保存，等待执行记录
          </Typography>
        )}
        <Typography variant="subtitle2">用途声明与条款确认</Typography>
        {order.consent ? (
          <>
            <Typography variant="body2">
              已确认 · {order.consent.version} ·{" "}
              {new Date(order.consent.acceptedAt).toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {order.consent.text}
            </Typography>
          </>
        ) : (
          <Typography color="text.secondary">历史未记录</Typography>
        )}
      </Stack>
    </Paper>
  );
}
export function LoadError({
  message,
  retry,
}: {
  message?: string;
  retry: () => void;
}) {
  return message ? (
    <Alert severity="error" action={<Button onClick={retry}>重试</Button>}>
      {message}
    </Alert>
  ) : null;
}
