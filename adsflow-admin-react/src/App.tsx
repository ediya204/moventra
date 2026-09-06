import { retiredTeamPath } from "./portal/personalV1";
import { isAdminSite } from './auth/site';
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, usesFirebaseAuth } from './auth/AuthContext';
const SessionPage = lazy(() => import('./auth/SessionPage'));
import { PageSkeleton } from './components/AsyncState';
import { DashboardLayout } from './components/DashboardLayout';
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage }))); 
import { isSlashDemoMode } from './utils/dataMode';
const FinancePage=lazy(()=>import('./finance/FinancePage'));
const CardAdminPage=lazy(()=>import('./card-admin/CardAdminPage'));
const LiveSlashPage=lazy(()=>import('./slash/LiveSlashPage'));
const BinManagementPage=lazy(()=>import('./bins/BinManagementPage'));
const AdminConsolePage=lazy(()=>import('./admin/AdminConsolePage'));
const ManagementPage = lazy(() => import('./management/ManagementPage'));
const ResetPasswordPage = lazy(() => import('./management/ResetPasswordPage'));
const FxPage = lazy(() => import('./fx/FxPage'));
const SourceDemoPage = lazy(() => import('./slash/SourceDemoPage')); 

const RegisterPage = lazy(() => import('./website/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./website/auth/ForgotPasswordPage'));
const StatusPage = lazy(() => import('./website/StatusPage'));

const Website = lazy(() => import('./website/Website'));

const ClientHome = lazy(() => import('./portal/ClientHome'));
const Portal = lazy(() => import('./portal/Portal'));

const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage').then((module) => ({ default: module.WorkbenchPage })));
const AnalyticsOverviewPage = lazy(() => import('./pages/AnalyticsOverviewPage').then((module) => ({ default: module.AnalyticsOverviewPage })));
const AccountsAnalyticsPage = lazy(() => import('./pages/AccountsAnalyticsPage').then((module) => ({ default: module.AccountsAnalyticsPage })));
const AnalysisTopicPage = lazy(() => import('./pages/AnalysisTopicPage').then((module) => ({ default: module.AnalysisTopicPage })));
const EntityAnalyticsPage = lazy(() => import('./pages/EntityAnalyticsPage').then((module) => ({ default: module.EntityAnalyticsPage })));
const AccountRiskGroupPage = lazy(() => import('./pages/AccountRiskGroupPage').then((module) => ({ default: module.AccountRiskGroupPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((module) => ({ default: module.CustomersPage })));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage').then((module) => ({ default: module.CustomerDetailPage })));
const CardsPage = lazy(() => import('./pages/CardsPage').then((module) => ({ default: module.CardsPage })));
const CardsOverviewPage = lazy(() => import('./pages/CardsOverviewPage').then((module) => ({ default: module.CardsOverviewPage })));
const UserCardAssetsPage = lazy(() => import('./pages/UserCardAssetsPage').then((module) => ({ default: module.UserCardAssetsPage })));
const UserCardAssetDetailPage = lazy(() => import('./pages/UserCardAssetDetailPage').then((module) => ({ default: module.UserCardAssetDetailPage })));
const CardOtpPage = lazy(() => import('./pages/CardOtpPage').then((module) => ({ default: module.CardOtpPage })));
const CardDetailPage = lazy(() => import('./pages/CardDetailPage').then((module) => ({ default: module.CardDetailPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then((module) => ({ default: module.TransactionsPage })));
const TransactionsOverviewPage = lazy(() => import('./pages/TransactionsOverviewPage').then((module) => ({ default: module.TransactionsOverviewPage })));
const TransactionDetailPage = lazy(() => import('./pages/TransactionDetailPage').then((module) => ({ default: module.TransactionDetailPage })));
const RiskPage = lazy(() => import('./pages/RiskPage').then((module) => ({ default: module.RiskPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const ReconciliationPage = lazy(() => import('./pages/ReconciliationPage').then((module) => ({ default: module.ReconciliationPage })));
const ReconciliationCasePage = lazy(() => import('./pages/ReconciliationCasePage').then((module) => ({ default: module.ReconciliationCasePage })));
const RevenuePage = lazy(() => import('./pages/RevenuePage').then((module) => ({ default: module.RevenuePage })));
const RevenueEventPage = lazy(() => import('./pages/RevenueEventPage').then((module) => ({ default: module.RevenueEventPage })));


function ProtectedRoute() {
  const { authenticated, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageSkeleton />;
  if (usesFirebaseAuth) return <Navigate to="/session" replace />;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export default function App() {
  const location = useLocation();
  const { authenticated, ready } = useAuth();
  const retired = retiredTeamPath(location.pathname);
  if (retired) {
    if (!ready) return <PageSkeleton />;
    if (usesFirebaseAuth) return <Navigate to={isAdminSite ? "/session" : "/portal"} replace />;
    return <Navigate to={retired.startsWith("/portal/") ? retired : authenticated ? retired : "/login"} replace />;
  }
  if (isSlashDemoMode) return <Suspense fallback={<PageSkeleton />}><Routes>
    <Route path="/session" element={<SessionPage />} />
    <Route path="/" element={<Website />} />
    <Route path="/portal/*" element={usesFirebaseAuth ? <ClientHome /> : <Portal />} />
    <Route path="/demo-reset-password" element={<ResetPasswordPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/404" element={<StatusPage />} />
    <Route path="/403" element={<StatusPage code={403} />} />
    <Route path="/500" element={<StatusPage code={500} />} />
    <Route element={<ProtectedRoute />}><Route element={<DashboardLayout />}>
      {['finance/crypto-flows','finance/otc','finance/otc/:id','finance/withdrawals','finance/withdrawals/:id','finance/records/:id'].map(path=><Route key={path} path={path} element={<FinancePage/>}/>)}
      <Route path="fx/*" element={<FxPage/>}/>
      <Route path="transactions" element={<LiveSlashPage kind="transactions" fallback={<FxPage/>}/>}/>
      <Route path="cards" element={<LiveSlashPage kind="cards" fallback={<CardAdminPage/>}/>}/>
      {["transactions/fx/:id","transactions/report","transactions/balances","transactions/differences","transactions/cards/:id"].map(path=><Route key={path} path={path} element={<FxPage/>}/>)}
      <Route path="card-bins/*" element={<BinManagementPage/>}/>
      <Route path="user-groups/*" element={<ManagementPage />} />
      {['workbench','approvals','pricing','finance/orders','finance/orders/:id','system/audit','system/channels','system/access','system/settings'].map(path=><Route key={path} path={path} element={<AdminConsolePage/>}/>)}
      <Route path="cards/:id/source" element={<SourceDemoPage/>}/>
      {['cards/:id','card-operations','card-operations/:id'].map(path=><Route key={path} path={path} element={<CardAdminPage/>}/>)}
      {['operations','customers','customers/:id','transactions/:id','risk','reports','reconciliation','demo/scenarios'].map(path => <Route key={path} path={path} element={<SourceDemoPage />} />)}

    </Route></Route>
  <Route path="*" element={<StatusPage />} />
  </Routes></Suspense>;
  if (isAdminSite) return <Suspense fallback={<PageSkeleton />}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/session" element={<SessionPage />} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></Suspense>;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
    <Route path="/session" element={<SessionPage />} />
        <Route path="/" element={<Website />} />
    <Route path="/portal/*" element={usesFirebaseAuth ? <ClientHome /> : <Portal />} />
    <Route path="/demo-reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/404" element={<StatusPage />} />
    <Route path="/403" element={<StatusPage code={403} />} />
    <Route path="/500" element={<StatusPage code={500} />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
      <Route path="fx/*" element={<FxPage/>}/>
      {["transactions/fx/:id","transactions/report","transactions/balances","transactions/differences","transactions/cards/:id"].map(path=><Route key={path} path={path} element={<FxPage/>}/>)}
      <Route path="card-bins/*" element={<BinManagementPage/>}/>
      <Route path="user-groups/*" element={<ManagementPage />} />
      {['workbench','approvals','pricing','finance/orders','finance/orders/:id','system/audit','system/channels','system/access','system/settings'].map(path=><Route key={path} path={path} element={<AdminConsolePage/>}/>)}
                  <Route path="operations" element={<WorkbenchPage />} />
            <Route path="analytics/overview" element={<AnalyticsOverviewPage />} />
            <Route path="analytics/accounts" element={<AccountsAnalyticsPage />} />
            <Route path="analytics/topics/:topic/:segment" element={<AnalysisTopicPage />} />
            <Route path="analytics/entities/:entityType/:entityId" element={<EntityAnalyticsPage />} />
            <Route path="risk/account-groups/:mainAccountId" element={<AccountRiskGroupPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:customerId" element={<CustomerDetailPage />} />
            <Route path="cards/overview" element={<CardsOverviewPage />} />
            <Route path="cards/assets" element={<UserCardAssetsPage />} />
            <Route path="cards/assets/:userId" element={<UserCardAssetDetailPage />} />
            <Route path="cards/otp" element={<CardOtpPage />} />
            <Route path="cards" element={<CardsPage/>} />
            <Route path="cards/:cardId" element={<CardDetailPage />} />
            <Route path="transactions/overview" element={<TransactionsOverviewPage />} />
            <Route path="transactions" element={<TransactionsPage/>} />
            <Route path="transactions/:billId" element={<TransactionDetailPage />} />
            <Route path="risk" element={<RiskPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="reconciliation" element={<ReconciliationPage />} />
            <Route path="reconciliation/cases/:caseId" element={<ReconciliationCasePage />} />
            <Route path="revenue" element={<RevenuePage />} />
            <Route path="revenue/events/:eventId" element={<RevenueEventPage />} />

          </Route>
        </Route>
      <Route path="*" element={<StatusPage />} />
  </Routes>
    </Suspense>
  );
}
