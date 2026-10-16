import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_USE_MOCK === 'true';

  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      // Cho phép truy cập qua tunnel ngrok (mọi subdomain).
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
      // Khi tắt mock, chuyển tiếp /api tới backend thật để tránh lỗi CORS.
      proxy: useMock
        ? undefined
        : {
            '/api': {
              target: env.API_PROXY_TARGET || 'http://localhost:8080',
              changeOrigin: true,
            },
          },
    },
  };
});
