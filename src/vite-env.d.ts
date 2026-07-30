/**
 * Minimal typing for the Vite build-time environment. Only the browser entry
 * point reads it, and only to decide whether authority sync is configured, so
 * the full `vite/client` type surface is not pulled into the project.
 */
interface ImportMetaEnv {
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
