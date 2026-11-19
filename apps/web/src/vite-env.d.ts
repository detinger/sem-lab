/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the SEM Studio API. Browser-exposed: never put credentials in VITE_* variables. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
