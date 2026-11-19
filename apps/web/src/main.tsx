import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { registerStaleChunkReload } from '@/app/staleChunk';
import { applyTheme, resolveInitialTheme } from '@/app/theme';

import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// Recover from stale page chunks after a redeploy by reloading to the current build.
registerStaleChunkReload();

applyTheme(resolveInitialTheme());

// End-to-end tests drive the app through this hook; it does not exist in a production build.
if (import.meta.env.DEV) void import('@/features/ipma/devHook').then((m) => m.registerDevHook());

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
