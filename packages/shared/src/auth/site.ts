// Fixed by each application build, never selected by a request or query parameter.
export const isAdminSite = import.meta.env.VITE_SITE_KIND === 'admin';
export const siteTitle = isAdminSite ? 'Moventra 运营后台' : 'Moventra 客户端';
export const loginPath = isAdminSite ? '/admin/login' : '/portal/login';
export const sessionPath = isAdminSite ? '/admin-api/v1/me' : '/client-api/v1/me';
