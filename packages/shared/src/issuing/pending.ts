export type PendingIssuing = {
  key: string;
  path: string;
  body: Record<string, unknown>;
};
const prefix = "moventra:issuing:";
export function pendingKey(uid: string, customer: string) {
  return `${prefix}${uid}:${customer}`;
}
export function readPending(key: string): PendingIssuing | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value &&
      typeof value.key === "string" &&
      typeof value.path === "string" &&
      value.body
      ? value
      : null;
  } catch {
    return null;
  }
}
export function savePending(key: string, value: PendingIssuing) {
  // Persist BEFORE sending: a storage failure must not send a non-recoverable payment.
  sessionStorage.setItem(key, JSON.stringify(value));
}
export function clearIssuingPending() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
}
