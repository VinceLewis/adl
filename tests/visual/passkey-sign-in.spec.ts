import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  PASSKEY_RELYING_PARTY_ID,
  startPasskeyAuthority,
  type PasskeyAuthorityHarness,
} from "./passkey-authority.js";

/**
 * The passkey sign-in surface in a real browser.
 *
 * This project exists because of a gap the phase document names explicitly:
 * `npm run verify:push` screenshots the reference app with **no authority
 * configured**, so session chrome does not render there and a green visual run
 * proves nothing about signing in. The integration suite proves the ceremony
 * against real PostgreSQL; what only a browser can prove is that the real
 * WebAuthn API, the real bridge and the real HTTP edge complete a ceremony
 * together — which is what this does, using Chromium's virtual authenticator so
 * every signature is genuinely produced and genuinely verified.
 */

let authority: PasskeyAuthorityHarness;

test.beforeAll(async () => {
  authority = await startPasskeyAuthority();
});

test.afterAll(async () => {
  await authority?.close();
});

test("registers a passkey from an invitation and then signs in with it", async ({ page }) => {
  const client = await addVirtualAuthenticator(page);
  const inviteToken = await authority.invite();

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  // A passkey deployment must not keep a typed credential as a second way in.
  await expect(panel.locator("[data-session-account-proof='true']")).toHaveCount(0);
  await expect(panel.locator("[data-session-passkey-sign-in='true']")).toBeVisible();
  await page.screenshot({
    path: "test-results/visual/passkey-signed-out.png",
    fullPage: true,
  });

  await panel.locator("[data-session-passkey-invite='true']").fill(inviteToken);
  await panel.locator("[data-session-register-passkey='true']").click();

  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  const signedInUserId = await panel.locator("[data-session-identity] strong").innerText();
  expect(signedInUserId).toMatch(/^user-/u);
  await expect(panel.locator("[data-session-notice='true']")).toContainText("registered");
  // The credential really was created by the authenticator, not simulated by
  // the page: it is the virtual authenticator that now holds it.
  const credentials = await client.send("WebAuthn.getCredentials", {
    authenticatorId: authenticatorId(client),
  });
  expect(credentials.credentials.length).toBe(1);
  expect(credentials.credentials[0]?.rpId).toBe(PASSKEY_RELYING_PARTY_ID);
  await page.screenshot({ path: "test-results/visual/passkey-signed-in.png", fullPage: true });

  await panel.locator("[data-session-sign-out='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  // Signing back in needs no invitation, no user name and nothing typed: the
  // credential is discoverable and the authority resolves the identity from it.
  await panel.locator("[data-session-passkey-sign-in='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  await expect(panel.locator("[data-session-identity] strong")).toHaveText(signedInUserId);
});

test("refuses to sign in when the browser holds no credential, and issues no session", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  await panel.locator("[data-session-passkey-sign-in='true']").click();

  // Whether the authenticator refuses or the authority does, the outcome is the
  // same and it is stated: still signed out, no session, no silent success.
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");
  await expect(panel.locator("[data-session-identity]")).toHaveCount(0);
});

const authenticators = new WeakMap<CDPSession, string>();

async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const added = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      // Discoverable credentials with user verification: exactly what the
      // authority asks for, so the ceremony needs no user name.
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  authenticators.set(client, added.authenticatorId);
  return client;
}

function authenticatorId(client: CDPSession): string {
  const id = authenticators.get(client);
  if (id === undefined) throw new Error("No virtual authenticator was added for this page.");
  return id;
}
