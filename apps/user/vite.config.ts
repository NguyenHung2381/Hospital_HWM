import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_USE_MOCK === 'true';
  // `npm run dev:user:lan`: HTTPS (chứng chỉ tự ký) + mở cho mạng LAN — camera trên điện thoại
  // chỉ hoạt động trong secure context.
  const lanHttps = env.DEV_LAN_HTTPS === 'true';

  return {
    plugins: [react(), ...(lanHttps ? [basicSsl()] : [])],
    server: {
      port: 5173,
      strictPort: true,
      host: lanHttps ? true : undefined,
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
