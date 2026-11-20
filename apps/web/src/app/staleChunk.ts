// A redeploy replaces every page's hashed chunk (e.g. DataPage-<hash>.js). A tab still running
// the previous build points at the old hashes; once the user opens a not-yet-loaded page, the
// fetch 404s and Netlify's SPA fallback serves index.html as text/html, so the browser can't run
// it as a module — "Failed to fetch dynamically imported module". Reloading pulls the fresh
// index.html and its current chunk hashes, after which the same navigation succeeds.
//
// Vite dispatches `vite:preloadError` on window for exactly this failure. We reload once; a
// sessionStorage guard prevents a reload loop when the chunk is genuinely unreachable (offline,
// a truly missing file) rather than merely stale.

const RELOAD_GUARD_KEY = 'sem-lab:stale-chunk-reloaded-at';
const RELOAD_GUARD_WINDOW_MS = 10_000;

/** Reload once to pick up the current deploy, unless we just did (loop guard). */
export function reloadForStaleChunk(): void {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
  if (Date.now() - last < RELOAD_GUARD_WINDOW_MS) return;
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

/** True when an error is a failed dynamic-import of an app chunk (stale deploy, offline, …). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return (
    /dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

/** Wire up the global `vite:preloadError` listener. Call once at startup. */
export function registerStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    // We own the recovery (reload); stop Vite from rethrowing the rejection.
    event.preventDefault();
    reloadForStaleChunk();
  });
}
