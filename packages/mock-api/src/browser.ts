import { getResponse, HttpHandler } from 'msw';
import { setupWorker } from 'msw/browser';
import { resetMockDb } from './db';
import { createHandlers } from './handlers';

export interface StartMockOptions {
  /** Tiền tố API, trùng với baseURL của api-client. */
  baseURL?: string;
  /** Đường dẫn tới `mockServiceWorker.js` (tạo bằng `npx msw init public`). */
  serviceWorkerUrl?: string;
  quiet?: boolean;
}

export type MockMode = 'service-worker' | 'fetch-fallback';

declare global {
  interface Window {
    __hwnMock?: { mode: MockMode; reset: () => void };
  }
}

/**
 * Phương án dự phòng khi không đăng ký được Service Worker — ví dụ mở app qua
 * `http://<IP LAN>` trên điện thoại (không phải secure context) hoặc trình duyệt chặn SW.
 * Thay `window.fetch` bằng bản chạy qua các handler; request không khớp vẫn đi ra mạng.
 * Chỉ chặn được request dùng fetch — api-client dùng adapter `fetch` của axios.
 */
function installFetchFallback(handlers: HttpHandler[]) {
  const passthrough = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await getResponse(handlers, request);
    return response ?? passthrough(input, init);
  };
}

/** Khởi động mock server trong trình duyệt. Gọi trước khi render app. */
export async function startMockWorker(options: StartMockOptions = {}): Promise<MockMode> {
  const handlers = createHandlers(options.baseURL);
  let mode: MockMode = 'service-worker';
  try {
    await setupWorker(...handlers).start({
      onUnhandledRequest: 'bypass',
      quiet: options.quiet,
      serviceWorker: { url: options.serviceWorkerUrl ?? '/mockServiceWorker.js' },
    });
  } catch (error) {
    console.warn(
      '[HWN mock] Không đăng ký được Service Worker — chuyển sang chặn fetch ngay trong trang.',
      error,
    );
    // Chỉ chặn được HTTP; WebSocket sẽ không kết nối được và client tự chuyển sang polling.
    installFetchFallback(handlers.filter((h): h is HttpHandler => h instanceof HttpHandler));
    mode = 'fetch-fallback';
  }
  window.__hwnMock = {
    mode,
    reset: () => {
      resetMockDb();
      window.location.reload();
    },
  };
  return mode;
}
