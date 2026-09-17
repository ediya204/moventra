import { defineConfig } from 'vite';
import { moventraWebConfig } from '../../packages/tooling/vite';
import { websiteSeoBuild } from './seo-build';
export default defineConfig(({mode}) => {
 const config = moventraWebConfig('client', mode);
 return { ...config, plugins: [...(config.plugins || []), websiteSeoBuild()] };
});
