import { useState } from "react";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { post } from "../../../../packages/shared/src/management/api";
export default function ResetPasswordPage() {
  const [token] = useState(() => window.location.hash.slice(1)),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const local =
    ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    (import.meta.env.DEV || import.meta.env.VITE_DATA_MODE === "slash-demo");
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper variant="outlined" sx={{ p: 4 }}>
        <Stack
          component="form"
          gap={3}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              d = new FormData(form);
            if (d.get("password") !== d.get("confirm")) {
              setError("两次输入的密码不一致");
              return;
            }
            setBusy(true);
            setError("");
            try {
              await post("reset/complete", {
                token,
                password: d.get("password"),
              });
              form.reset();
              window.history.replaceState(null, "", window.location.pathname);
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Typography variant="h4">设置新密码</Typography>
          <Typography color="text.secondary">
            本地 Demo 用户凭证 · 链接15分钟有效，仅能使用一次。
          </Typography>
          {done ? (
            <Alert severity="success">
              密码已更新，旧本地登录会话已失效。可以关闭此页面。
            </Alert>
          ) : !token || !local ? (
            <Alert severity="error">缺少有效的本地重置链接。</Alert>
          ) : (
            <>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                required
                name="password"
                type="password"
                label="新密码"
                autoComplete="new-password"
                inputProps={{ minLength: 12, maxLength: 128 }}
                helperText="12–128位，请勿使用真实业务密码"
              />
              <TextField
                required
                name="confirm"
                type="password"
                label="再次输入新密码"
                autoComplete="new-password"
                inputProps={{ minLength: 12, maxLength: 128 }}
              />
              <Button type="submit" variant="contained" disabled={busy}>
                保存新密码
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
