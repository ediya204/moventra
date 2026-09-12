export type OnboardingState = {customerId:string;name:string;onboardingStatus:'draft'|'submitted'|'approved'|'rejected';serviceStatus:'inactive'|'active'|'suspended';revision:number;allFeaturesEnabled:boolean};
export const clientFeaturesEnabled=(state:OnboardingState|null)=>state?.onboardingStatus==='approved'&&state.serviceStatus==='active'&&state.allFeaturesEnabled===true;
export function onboardingMessage(state:OnboardingState|null){
 if(!state)return '开户状态暂不可用，请刷新重试。';
 if(clientFeaturesEnabled(state))return '已审批开通 · 全部客户端功能权限默认开放。';
 if(state.serviceStatus==='suspended')return '服务已暂停，请联系运营。';
 if(state.onboardingStatus==='submitted')return '开户申请待后台审批。';
 if(state.onboardingStatus==='rejected')return '开户申请已驳回，请联系运营确认后重新提交。';
 if(state.onboardingStatus==='approved')return '开户审核已通过，等待后台开通服务。';
 return '尚未提交开户申请。';
}
