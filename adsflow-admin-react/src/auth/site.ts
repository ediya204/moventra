// Deployment-selected, never a query parameter or client-selected role.
export const isAdminSite = import.meta.env.VITE_SITE_KIND === 'admin';
export const siteTitle = isAdminSite ? 'Moventra 运营后台' : 'Moventra 客户端';
