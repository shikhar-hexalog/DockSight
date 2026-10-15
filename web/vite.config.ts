import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Shares the root .env with the server.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');

  return {
    // HTTPS (self-signed) because phones only allow the camera on secure pages.
    // DEV_HTTPS=0 serves plain http (no phone camera).
    plugins: [react(), tailwindcss(), ...(env.DEV_HTTPS === '0' ? [] : [basicSsl()])],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5180),
      strictPort: true,
      // Reachable from phones on the same Wi-Fi.
      host: true,
      proxy: {
        '/api': 'http://localhost:4000',
      },
    },
  };
});
