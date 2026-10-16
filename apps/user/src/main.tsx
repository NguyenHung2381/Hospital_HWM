import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { enableMocking } from './lib/mock';
import './styles.css';
import './screens.css';

/**
 * Service worker cho PWA (cài lên màn hình chính, mở được khi mất mạng).
 * Chỉ ở bản production và khi không dùng mock — mock cũng dùng service worker cùng phạm vi "/".
 */
function registerServiceWorker() {
  if (!import.meta.env.PROD || import.meta.env.VITE_USE_MOCK === 'true') return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[HWN] Không đăng ký được service worker', error);
    });
  });
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  registerServiceWorker();
});
