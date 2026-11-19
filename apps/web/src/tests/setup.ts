/**
 * Vitest setup, run before every test file in both the jsdom and the node environment.
 * DOM polyfills that only React Flow needs live in src/tests/support/react-flow-dom.ts and are
 * installed by the tests that render a canvas, so they cannot hide a missing API elsewhere.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so React Testing Library cannot register its own auto-cleanup.
afterEach(() => {
  cleanup();
});
