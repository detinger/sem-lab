import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { applyTheme, resolveInitialTheme } from '@/app/theme';

import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

applyTheme(resolveInitialTheme());

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
