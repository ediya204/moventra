import { defineConfig } from 'vite';
import { moventraWebConfig } from '../../packages/tooling/vite';
export default defineConfig(({mode}) => moventraWebConfig('client', mode));
