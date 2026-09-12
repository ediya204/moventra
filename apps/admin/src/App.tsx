import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { PageSkeleton } from '../../../packages/shared/src/components/AsyncState';
import { isDemoMode } from '../../../packages/shared/src/utils/dataMode';
import {useAuth} from '../../../packages/shared/src/auth/AuthContext';
const CustomerDirectoryPage=lazy(()=>import('./operations/CustomerDirectoryPage'));
const CardsPage=lazy(()=>import('./operations/CardsPage'));
const OnboardingPage=lazy(()=>import('./operations/OnboardingPage'));
const ChannelTransactionsPage=lazy(()=>import('./operations/ChannelTransactionsPage'));
const OperationsPage=lazy(()=>import('./operations/OperationsPage'));
const LoginPage=lazy(()=>import('../../../packages/shared/src/pages/LoginPage').then(m=>({default:m.LoginPage})));
const SessionPage=lazy(()=>import('../../../packages/shared/src/auth/SessionPage'));
const ForgotPasswordPage=lazy(()=>import('../../../packages/shared/src/website/auth/ForgotPasswordPage'));
const DemoApp=import.meta.env.DEV ? lazy(()=>import('./DemoApp')) : null;
function SessionEntry(){const {authenticated,session}=useAuth();const [params]=useSearchParams();return authenticated&&session?.operator&&session.mfaVerified&&!params.has('security')?<Navigate to="/workbench" replace/>:<SessionPage/>;}
export default function App(){
 return <Suspense fallback={<PageSkeleton/>}>{DemoApp && isDemoMode ? <DemoApp/> : <Routes>
  <Route path="/admin/login" element={<LoginPage/>}/>
  <Route path="/login" element={<Navigate to="/admin/login" replace/>}/>
  <Route path="/portal/*" element={<div role="alert">404 · 此站点不提供客户登录</div>}/>
  <Route path="/session" element={<SessionEntry/>}/>
  <Route path="/transactions" element={<ChannelTransactionsPage/>}/>
  <Route path="/customers" element={<CustomerDirectoryPage/>}/>
  <Route path="/cards" element={<CardsPage/>}/>
  <Route path="/system/channels" element={<CardsPage channels/>}/>
  <Route path="/cards/:id" element={<ChannelTransactionsPage/>}/>
  <Route path="/" element={<Navigate to="/workbench" replace/>}/>
  <Route path="/onboarding" element={<OnboardingPage/>}/>
  <Route path="/onboarding/:customerId" element={<OnboardingPage/>}/>
  <Route path="/workbench" element={<OperationsPage/>}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  <Route path="*" element={<Navigate to="/admin/login" replace/>}/>
 </Routes>}</Suspense>;
}
