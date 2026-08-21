import { expect, test } from "@playwright/test";

/** Targets an operator-supplied HTTPS deployment, never a test fixture. */
test("restores the supplied persistent passkey session in a fresh browser context", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedIn");
  await expect(panel.locator("[data-session-identity] strong")).toHaveText(/.+/u);
  // A restored session must not expose ADL's intentionally absent account-proof fallback.
  await expect(panel.locator("[data-session-account-proof='true']")).toHaveCount(0);
});
