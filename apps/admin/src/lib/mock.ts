import { API_BASE_URL } from './api';

/** Bật mock server (MSW) nếu VITE_USE_MOCK=true. Khi build production với mock tắt, đoạn này bị loại bỏ. */
export async function enableMocking() {
  if (import.meta.env.VITE_USE_MOCK !== 'true') return;
  const { startMockWorker } = await import('@hwn/mock-api/browser');
  await startMockWorker({
    baseURL: API_BASE_URL,
    serviceWorkerUrl: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
  });
}
