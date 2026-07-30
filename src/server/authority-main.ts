import { startAuthorityProcess } from "./authority-entrypoint.js";

// Only the error name and message are printed. A stack, cause or configuration
// dump here could carry a connection string, session token or account proof.
void startAuthorityProcess().catch((error: unknown) => {
  console.error(
    error instanceof Error ? `${error.name}: ${error.message}` : "Error: authority startup failed",
  );
  process.exitCode = 1;
});
