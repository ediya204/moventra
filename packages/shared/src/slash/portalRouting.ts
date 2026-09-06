// Keep client navigation inside its own workspace; never route a client to admin login.
export function portalHref(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/portal/')) return path;
  if (path === '/workbench') return '/portal/overview';
  if (path === '/reports') return '/portal/funds';
  return `/portal${path}`;
}
export function sourceViewPath(path: string): string {
  if (!path.startsWith('/portal')) return path;
  const relative = path.slice('/portal'.length) || '/overview';
  if (relative === '/overview') return '/workbench';
  if (relative === '/funds') return '/reports';
  // Preserve third-level card transaction links from the client card workflow.
  const transaction = relative.match(/^\/cards\/[^/]+\/transactions\/([^/]+)$/);
  return transaction ? `/transactions/${transaction[1]}` : relative;
}
export const portalDemoBase = '/local-slash-demo';
export const adminDemoBase = '/admin-api/settlement-management/demo';
export function sourceApiBase(portal: boolean) { return portal ? portalDemoBase : adminDemoBase; }

export function safeClientReturn(value: string | null, fallback: string): string {
  if (!value || value.length > 4096 || /[\\\r\n]/.test(value)) return fallback;
  return /^\/portal\/(cards|transactions|funds|risk)(?:[/?]|$)/.test(value) ? value : fallback;
}
export function clientDetailHref(kind: string, id: string, returnTo: string, cardId?: string): string {
  const section = kind === 'accounts' ? 'customers' : kind;
  const path = kind === 'transactions' && cardId
    ? `/portal/cards/${encodeURIComponent(cardId)}/transactions/${encodeURIComponent(id)}`
    : `/portal/${section}/${encodeURIComponent(id)}`;
  return `${path}?${new URLSearchParams({returnTo: safeClientReturn(returnTo, `/portal/${section}`)})}`;
}
