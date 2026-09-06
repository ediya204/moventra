import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function moventraWebConfig(kind: 'admin' | 'client', mode: string): UserConfig {
 const env = loadEnv(mode, process.cwd(), '');
 return {
  plugins:[react()],
  // Application identity is fixed by its own config, not an environment override.
  define:{'import.meta.env.VITE_SITE_KIND': JSON.stringify(kind)},
  publicDir:resolve(root,'packages/assets/public'),
  resolve:{dedupe:['react','react-dom','firebase','@emotion/react','@emotion/styled']},
  server:{host:'127.0.0.1',port:kind==='admin'?8850:8853,fs:{allow:[root]},proxy:{
   '^/(api/v1|client-api/v1|admin-api/v1)/':{target:env.VITE_GO_API_PROXY_TARGET || 'http://127.0.0.1:8870',changeOrigin:false},
   '/local-slash-demo':{target:'http://127.0.0.1:8862',changeOrigin:false,rewrite:p=>p.replace(/^\/local-slash-demo/,'/admin-api/settlement-management/demo')},
   '/admin-api':{target:env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8862',changeOrigin:false}
  }},
  build:{outDir:'dist'},
  preview:{host:'127.0.0.1',port:kind==='admin'?8851:8854}
 };
}
