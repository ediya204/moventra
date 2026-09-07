import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { PageSkeleton } from '../../../packages/shared/src/components/AsyncState';
import { isDemoMode } from '../../../packages/shared/src/utils/dataMode';
import {useAuth} from '../../../packages/shared/src/auth/AuthContext';
const ChannelTransactionsPage=lazy(()=>import('./operations/ChannelTransactionsPage'));
const OperationsPage=lazy(()=>import('./operations/OperationsPage'));
const LoginPage=lazy(()=>import('../../../packages/shared/src/pages/LoginPage').then(m=>({default:m.LoginPage})));
const SessionPage=lazy(()=>import('../../../packages/shared/src/auth/SessionPage'));
const ForgotPasswordPage=lazy(()=>import('../../../packages/shared/src/website/auth/ForgotPasswordPage'));
const DemoApp=import.meta.env.DEV ? lazy(()=>import('./DemoApp')) : null;
function SessionEntry(){const {authenticated,session}=useAuth();const [params]=useSearchParams();return authenticated&&session?.operator&&session.mfaVerified&&!params.has('security')?<Navigate to="/workbench" replace/>:<SessionPage/>;}
export default function App(){
 return <Suspense fallback={<PageSkeleton/>}>{DemoApp && isDemoMode ? <DemoApp/> : <Routes>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/session" element={<SessionEntry/>}/>
  <Route path="/transactions" element={<ChannelTransactionsPage/>}/>
  <Route path="/cards/:id" element={<ChannelTransactionsPage/>}/>
  <Route path="/workbench" element={<OperationsPage/>}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  <Route path="*" element={<Navigate to="/login" replace/>}/>
 </Routes>}</Suspense>;
}
