/// <reference types="vite/client" />

declare module '*.txt?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}

// Injected by vite.config.ts from the gitignored config/local-provider.json;
// undefined in tests and null when the file is absent.
declare const __MARGINALIA_LOCAL_PROVIDER__: {
  name?: string;
  description?: string;
  baseUrl?: string;
  defaultModelId?: string;
  models?: Array<{ id: string; name?: string }>;
} | null | undefined;
