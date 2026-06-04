import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'pages/login.html'),
        register: resolve(__dirname, 'pages/register.html'),
        memberDashboard: resolve(__dirname, 'pages/member/dashboard.html'),
        adminDashboard: resolve(__dirname, 'pages/admin/dashboard.html'),
      }
    }
  },
  server: {
    port: 3000
  }
});
