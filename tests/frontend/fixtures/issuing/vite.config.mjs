import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../../../../',import.meta.url));
const evidence=process.env.ISSUING_BROWSER_OUTPUT;
if(!evidence)throw new Error('ISSUING_BROWSER_OUTPUT must point to the isolated Go harness');
const {api}=JSON.parse(readFileSync(evidence,'utf8'));
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(api))throw new Error('loopback API required');
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[{
 name:'isolated-issuing-auth',enforce:'pre',
 resolveId(source,importer){
  if(!importer)return;
  if(source.endsWith('/AuthContext'))return '\0fixture-auth';
  if((importer.includes('/issuing/api.ts')||importer.includes('/auth/'))&&source==='../firebase')return '\0fixture-firebase';
  if((importer.includes('/issuing/api.ts')&&source==='../auth/site')||(importer.includes('/auth/')&&source==='./site'))return '\0fixture-site';
 },
 load(id){
  if(id==='\0fixture-site')return `export const isAdminSite=location.pathname.startsWith('/card-bins');`;
  if(id==='\0fixture-firebase')return `const user={uid:'alice',getIdToken:async()=>location.pathname.startsWith('/card-bins')?'staff':'alice'};export const getFirebaseAuth=()=>({currentUser:user});`;
  if(id==='\0fixture-auth')return `export const useAuth=()=>({ready:true,authenticated:true,user:{uid:'staff',email:'fixture@example.invalid'},profile:{name:'隔离验收运营'},session:{operator:true,mfaVerified:true},signOut(){}});`;
 }
},react()],server:{host:'127.0.0.1',port:8897,strictPort:true,fs:{allow:[repository]},proxy:{'/client-api':{target:api},'/admin-api':{target:api}}}});
