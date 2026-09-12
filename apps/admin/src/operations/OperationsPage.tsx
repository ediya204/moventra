import {DashboardLayout} from '../components/DashboardLayout';
import {Navigate,useLocation} from 'react-router-dom';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import FundsOverview from './FundsOverview';
export default function OperationsPage(){
 const {ready,authenticated,user,session}=useAuth();const location=useLocation();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||session?.operator!==true||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} state={{from:location.pathname}} replace/>;
 return <DashboardLayout production><FundsOverview/></DashboardLayout>;
}
