import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PageSkeleton } from '../../../packages/shared/src/components/AsyncState';
import { retiredTeamPath } from '../../../packages/shared/src/portal/personalV1';
import { usesFirebaseAuth } from '../../../packages/shared/src/auth/AuthContext';
const Website = lazy(() => import('./website/Website'));
const ClientHome = lazy(() => import('./portal/ClientHome'));
const Portal = import.meta.env.DEV ? lazy(() => import('./portal/Portal')) : null;
const SessionPage = lazy(() => import('../../../packages/shared/src/auth/SessionPage'));
const LoginPage = lazy(() => import('../../../packages/shared/src/pages/LoginPage').then(m => ({default:m.LoginPage})));
const RegisterPage = lazy(() => import('./website/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('../../../packages/shared/src/website/auth/ForgotPasswordPage'));
const StatusPage = lazy(() => import('../../../packages/shared/src/website/StatusPage'));
export default function App() {
 const location=useLocation();
 if(retiredTeamPath(location.pathname)) return <Navigate to="/portal" replace />;
 return <Suspense fallback={<PageSkeleton />}><Routes>
  <Route path="/" element={<Website/>}/>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  <Route path="/register" element={<RegisterPage/>}/>
  <Route path="/session" element={<SessionPage/>}/>
  <Route path="/portal/*" element={usesFirebaseAuth || !Portal ? <ClientHome/> : <Portal/>}/>
  <Route path="*" element={<StatusPage/>}/>
 </Routes></Suspense>;
}
