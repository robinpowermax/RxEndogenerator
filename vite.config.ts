import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/RxEndogenerator/', // 必须和你的仓库名一模一样
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});