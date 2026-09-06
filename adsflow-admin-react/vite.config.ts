import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget =
    mode === 'slash-demo' ? 'http://127.0.0.1:8862' : env.VITE_API_PROXY_TARGET || 'https://0c76576a046595_service.adsflow.me';

  return {
    plugins: [react(), {name:'local-live-data-boundary',configureServer(server){
      server.middlewares.use((req,res,next)=>{
        if(req.url?.startsWith('/local-slash-demo/management/live') &&
          !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')){
          res.statusCode=403;res.end('Real channel data is local-only');return;
        }
        next();
      });
    }}],
    server: {
      port: mode === 'slash-demo' ? 8852 : Number(env.VITE_PORT || 8850),
      proxy: {
        // Local synthetic client data has a dedicated proxy; never use the remote admin target.
        '/local-slash-demo': {
          target: 'http://127.0.0.1:8862',
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/local-slash-demo/, '/admin-api/settlement-management/demo'),
        },
        '/admin-api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: proxyTarget.startsWith('https://'),
        },
      },
    },
    preview: {
      port: Number(env.VITE_PREVIEW_PORT || 8851),
    },
  };
});
