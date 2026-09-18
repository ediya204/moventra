import {Navigate,useParams} from 'react-router-dom';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import FundRecords from '../../../../packages/shared/src/finance/FundRecords';
export default function FundRecordsPage(){
 const {ready,authenticated,user,session}=useAuth();const {recordId}=useParams();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 return <DashboardLayout production><FundRecords admin recordId={recordId}/></DashboardLayout>
}
