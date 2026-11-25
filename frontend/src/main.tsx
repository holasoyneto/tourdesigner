import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BASE_PATH, withBase } from './lib/basePath';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const scope = BASE_PATH ? `${BASE_PATH}/` : '/';
    navigator.serviceWorker.register(withBase('/sw.js'), { scope }).catch(() => undefined);
  });
}
