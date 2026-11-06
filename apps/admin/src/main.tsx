import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { enableMocking } from './lib/mock';
import '@hwn/theme/tokens.css';
import './styles.css';

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
