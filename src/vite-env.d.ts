/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL que recibe las sugerencias de herramientas. Vacío = envío deshabilitado. Ver README.md. */
  readonly VITE_SUGGESTIONS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
