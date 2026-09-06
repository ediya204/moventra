/**
 * Remote-only sensitive field session. Never returns the CVV to application state.
 * Customer BFF contract is documented in docs/client-cvv.md; no local fallback.
 */
export type CvvStatus = {
  phase: "idle" | "loading" | "visible" | "error";
  message?: string;
  expiresAt?: number;
};
type Options = {
  remoteCardId: string;
  write: (value: string) => void;
  status: (status: CvvStatus) => void;
  isActive: () => boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  schedule?: (callback: () => void, milliseconds: number) => () => void;
};
const MAX_VISIBLE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const failure = "暂时无法获取 CVV，请稍后重试。";
export function createCvvSession(options: Options) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const schedule =
    options.schedule ||
    ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  let sequence = 0;
  let disposed = false;
  let controller: AbortController | undefined;
  let cancelExpiry: (() => void) | undefined;
  let cancelRequest: (() => void) | undefined;
  const clear = () => {
    sequence += 1;
    controller?.abort();
    controller = undefined;
    cancelExpiry?.();
    cancelExpiry = undefined;
    cancelRequest?.();
    cancelRequest = undefined;
    options.write("");
  };
  const hide = () => {
    clear();
    if (!disposed) options.status({ phase: "idle" });
  };
  const show = async () => {
    if (disposed) return;
    clear();
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(options.remoteCardId) ||
      !options.isActive()
    ) {
      options.status({
        phase: "error",
        message: "请在当前卡片详情页重新查看。",
      });
      return;
    }
    const request = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    options.status({ phase: "loading" });
    cancelRequest = schedule(() => {
      if (disposed || request !== sequence) return;
      clear();
      options.status({ phase: "error", message: "请求超时，请重新查看。" });
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(
        `/client-api/cards/${encodeURIComponent(options.remoteCardId)}/cvv/reveal`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "ADSFLOW-Portal",
          },
          body: JSON.stringify({ purpose: "cardholder-view" }),
        },
      );
      if (disposed || request !== sequence || signal.aborted) return;
      if (!response.ok) {
        // Do not read or echo upstream error bodies; they could contain card secrets.
        if (response.status === 401 || response.status === 403)
          throw new Error("需要重新登录或完成安全验证后才能查看。");
        throw new Error(failure);
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json") ||
        !response.headers
          .get("cache-control")
          ?.toLowerCase()
          .split(",")
          .some((part) => part.trim() === "no-store")
      )
        throw new Error(failure);
      const payload: unknown = await response.json();
      if (
        disposed ||
        request !== sequence ||
        signal.aborted ||
        !options.isActive()
      ) {
        if (request === sequence) hide();
        return;
      }
      if (!payload || typeof payload !== "object") throw new Error(failure);
      const data = payload as Record<string, unknown>;
      const expiry =
        typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
      if (
        data.source !== "upstream" ||
        data.cardId !== options.remoteCardId ||
        typeof data.cvv !== "string" ||
        !/^\d{3,4}$/.test(data.cvv) ||
        !Number.isFinite(expiry) ||
        expiry <= now()
      )
        throw new Error(failure);
      const expiresAt = Math.min(expiry, now() + MAX_VISIBLE_MS);
      cancelRequest?.();
      cancelRequest = undefined;
      options.write(data.cvv);
      // Release the parsed object's reference to the field as soon as it is rendered.
      data.cvv = undefined;
      options.status({ phase: "visible", expiresAt });
      cancelExpiry = schedule(hide, expiresAt - now());
    } catch (cause) {
      if (disposed || request !== sequence || signal.aborted) return;
      clear();
      // Network/parser errors never go to logs, telemetry or user-facing error text.
      options.status({
        phase: "error",
        message:
          cause instanceof Error &&
          cause.message === "需要重新登录或完成安全验证后才能查看。"
            ? cause.message
            : failure,
      });
    }
  };
  return {
    show,
    hide,
    dispose: () => {
      disposed = true;
      clear();
    },
  };
}
