// Deployment-selected, never a query parameter or client-selected role.
export const isAdminSite = import.meta.env.VITE_SITE_KIND === 'admin';
export const siteTitle = isAdminSite ? 'Moventra 运营后台' : 'Moventra 客户端';

// Login UX precheck only. Go staff grants + MFA remain the authorization boundary.
// Missing admin build configuration fails closed.
const adminLoginEmails = new Set(String(import.meta.env.VITE_ADMIN_LOGIN_EMAILS || '').split(',').map((email: string) => email.trim().toLowerCase()).filter(Boolean));
export const acceptsLoginEmail = (email: string) => !isAdminSite || adminLoginEmails.has(email.trim().toLowerCase());
