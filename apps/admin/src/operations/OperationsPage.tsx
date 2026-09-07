import {Navigate,Link,useLocation} from 'react-router-dom';
import {Box,Button,Container,Stack,Typography} from '@mui/material';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import FundsOverview from './FundsOverview';
export default function OperationsPage(){
 const {ready,authenticated,user,session,signOut}=useAuth();const location=useLocation();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||session?.operator!==true||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/login'} state={{from:location.pathname}} replace/>;
 return <Box sx={{minHeight:'100vh',bgcolor:'background.default'}}><Box component="header" sx={{bgcolor:'background.paper',borderBottom:1,borderColor:'divider',px:{xs:2,md:5},py:2}}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}><Box component={Link} to="/workbench" sx={{textDecoration:'none',color:'text.primary'}}><Typography variant="h6" sx={{letterSpacing:2}}>MOVENTRA</Typography><Typography variant="caption" color="text.secondary">管理总后台</Typography></Box><Stack component="nav" aria-label="运营导航" direction="row" gap={1}><Button component={Link} to="/workbench">资金与运营</Button><Button component={Link} to="/session?security=1">身份与权限</Button><Button onClick={signOut}>退出</Button></Stack></Stack></Box><Container maxWidth="xl" component="main" sx={{py:{xs:3,md:5}}}><FundsOverview/></Container></Box>;
}
