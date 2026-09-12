import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {Box,Button,Container,Stack,Typography} from '@mui/material';
import {Link,Navigate,useParams} from 'react-router-dom';
import OnboardingPanel from '../../../../packages/shared/src/onboarding/OnboardingPanel';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
export default function OnboardingPage(){
 const {ready,authenticated,user,session}=useAuth();const {customerId}=useParams();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/login'} replace/>;
 const scopes=session.staffScopes.filter(g=>g.permission==='onboarding:review');
 return <Container maxWidth="lg" sx={{py:4}}><Stack spacing={3}>
  <Button component={Link} to="/workbench" sx={{alignSelf:'start'}}>返回运营工作台</Button>
  <Typography variant="h4">开户审批</Typography>
  {customerId?<><Button component={Link} to="/onboarding">返回客户列表</Button>{scopes.some(g=>g.customerId===customerId)?<OnboardingPanel key={customerId} customerId={customerId} admin/>:<Typography>没有该客户的开户审批权限。</Typography>}</>:scopes.length?scopes.map(g=><Box key={g.customerId}><Button component={Link} to={`/onboarding/${g.customerId}`}>{g.name}</Button></Box>):<Typography>暂无获授权的开户申请范围。需要按客户授予开户审批权限。</Typography>}
 </Stack></Container>;
}
