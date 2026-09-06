import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageSkeleton } from '../../../packages/shared/src/components/AsyncState';
import { isDemoMode } from '../../../packages/shared/src/utils/dataMode';
const LoginPage=lazy(()=>import('../../../packages/shared/src/pages/LoginPage').then(m=>({default:m.LoginPage})));
const SessionPage=lazy(()=>import('../../../packages/shared/src/auth/SessionPage'));
const ForgotPasswordPage=lazy(()=>import('../../../packages/shared/src/website/auth/ForgotPasswordPage'));
const DemoApp=import.meta.env.DEV ? lazy(()=>import('./DemoApp')) : null;
export default function App(){
 return <Suspense fallback={<PageSkeleton/>}>{DemoApp && isDemoMode ? <DemoApp/> : <Routes>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/session" element={<SessionPage/>}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  <Route path="*" element={<Navigate to="/login" replace/>}/>
 </Routes>}</Suspense>;
}
