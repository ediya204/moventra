// Run after firebase deploy --only auth --project edi-gws-20260309-hk.
// Patches only declared settings, preserving unrelated providers and domains.
import { execFileSync } from 'node:child_process';
const project = 'edi-gws-20260309-hk';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
const headers = {Authorization:`Bearer ${token}`,'X-Goog-User-Project':project,'Content-Type':'application/json'};
const before = await fetch(url, {headers,signal:AbortSignal.timeout(30000)});
if(!before.ok)throw new Error(`Read auth configuration: HTTP ${before.status}`);
const current = await before.json();
const providers=(current.mfa?.providerConfigs || []).filter(p=>!p.totpProviderConfig);
const patch={
 authorizedDomains:[...new Set([...(current.authorizedDomains || []),'moventra.apexisnetworking.work','admin.moventra.apexisnetworking.work','localhost'])],
 mfa:{...current.mfa,state:'ENABLED',providerConfigs:[...providers,{state:'ENABLED',totpProviderConfig:{adjacentIntervals:1}}]},
 emailPrivacyConfig:{enableImprovedEmailPrivacy:true},
};
const response=await fetch(url+'?updateMask=authorizedDomains,mfa,emailPrivacyConfig',{method:'PATCH',headers,body:JSON.stringify(patch),signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error(`Update auth configuration: HTTP ${response.status}`);
console.log('Authorized domains, TOTP (one adjacent interval), and email enumeration protection configured.');
// Never log full auth configuration: it contains password hash signing material.
