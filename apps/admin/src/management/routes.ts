// V1 presents commercial pricing inheritance as fee plans, not customer teams.
export function legacyFeePlanRedirect(pathname: string, search = ''): string | null {
  const match = /^\/user-groups\/groups(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  return (match[1] ? `/pricing/plans/${match[1]}` : '/pricing') + search;
}
export function managementDetailPath(resource: 'groups' | 'users', id?: string): string {
  const base = resource === 'groups' ? '/pricing/plans' : '/user-groups/users';
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}
