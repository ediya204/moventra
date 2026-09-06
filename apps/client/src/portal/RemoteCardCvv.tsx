import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { Icon } from "@iconify/react";
import { createCvvSession, type CvvStatus } from "./remoteCvv";

/** Only pass a remote identity obtained from authenticated customer API data. */
export type RemoteCardIdentity = { source: "customer-api"; id: string };
export function RemoteCardCvv({
  remoteIdentity,
}: {
  remoteIdentity?: RemoteCardIdentity;
}) {
  const secretNode = useRef<HTMLSpanElement>(null);
  const session = useRef<ReturnType<typeof createCvvSession>>();
  const [status, setStatus] = useState<CvvStatus>({ phase: "idle" });
  const [remaining, setRemaining] = useState(0);
  const location = useLocation();
  const remoteId =
    remoteIdentity?.source === "customer-api" ? remoteIdentity.id : undefined;
  useLayoutEffect(() => {
    setStatus({ phase: "idle" });
    const node = secretNode.current;
    if (!node || !remoteId) return;
    const current = createCvvSession({
      remoteCardId: remoteId,
      write: (value) => {
        node.textContent = value;
      },
      status: setStatus,
      isActive: () =>
        document.visibilityState === "visible" && document.hasFocus(),
    });
    session.current = current;
    const clear = () => current.hide();
    window.addEventListener("blur", clear);
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      current.dispose();
      session.current = undefined;
      window.removeEventListener("blur", clear);
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [remoteId, location.key]);
  useEffect(() => {
    if (status.phase !== "visible" || !status.expiresAt) return;
    const refresh = () =>
      setRemaining(
        Math.max(0, Math.ceil((status.expiresAt! - Date.now()) / 1000)),
      );
    refresh();
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, [status]);
  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            卡片安全码 · CVV
          </Typography>
          <Typography
            component="div"
            variant="h6"
            sx={{ mt: 0.5, letterSpacing: 3, minHeight: 30 }}
          >
            {status.phase !== "visible" && (
              <span aria-label="安全码已隐藏">•••</span>
            )}
            <span
              ref={secretNode}
              hidden={status.phase !== "visible"}
              data-private="true"
              data-sensitive="true"
              data-hj-suppress
              className="fs-exclude ph-no-capture"
              aria-label="临时显示的卡片安全码"
            />
          </Typography>
        </Box>
        {status.phase === "visible" ? (
          <Button
            onClick={() => session.current?.hide()}
            startIcon={<Icon icon="solar:eye-closed-linear" />}
          >
            隐藏
          </Button>
        ) : (
          <Button
            variant="outlined"
            disabled={!remoteId || status.phase === "loading"}
            onClick={() => void session.current?.show()}
            startIcon={<Icon icon="solar:eye-linear" />}
          >
            {status.phase === "loading" ? "远程获取中…" : "查看 CVV"}
          </Button>
        )}
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        mt={1}
      >
        {!remoteId
          ? "演示卡未关联真实上游，暂不可查看安全码。"
          : status.phase === "visible"
            ? `${remaining} 秒后自动隐藏；离开或切换窗口立即清除。`
            : "点击后向远端实时获取，仅在当前页面临时显示。"}
      </Typography>
      {status.phase === "error" && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {status.message}
        </Alert>
      )}
    </Box>
  );
}
