import { expect, test } from "./support/evidence.js";
import { type CDPSession, type Page } from "@playwright/test";
import {
  allowSignedOutStartup,
  expectAuthorityAcceptedAfterSignIn,
} from "./support/authority-allowances.js";
import { expectAuthorityDenied, expectNoRequestTo } from "./support/expect-absence.js";
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

test("registers a passkey from an invitation and then signs in with it", async ({
  page,
  evidence,
}, testInfo) => {
  allowSignedOutStartup(evidence);
  const client = await addVirtualAuthenticator(page);
  const inviteToken = await authority.invite();

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  // A passkey deployment must not keep a typed credential as a second way in.
  await expect(panel.locator("[data-session-account-proof='true']")).toHaveCount(0);
  await expect(panel.locator("[data-session-passkey-sign-in='true']")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("passkey-signed-out.png"),
    fullPage: true,
  });

  await panel.locator("[data-session-passkey-invite='true']").fill(inviteToken);
  await panel.locator("[data-session-register-passkey='true']").click();

  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  const signedInUserId = await panel.locator("[data-session-identity] strong").innerText();
  expect(signedInUserId).toMatch(/^user-/u);
  // The positive half of `allowSignedOutStartup`, asserted against the
  // authority's own log rather than the UI: the pre-sign-in 401s really were
  // pre-sign-in, because a later bootstrap for this session was accepted.
  // Without this, "401 on bootstrap is allowed" would be satisfied by an app
  // that never signs in at all.
  await expectAuthorityAcceptedAfterSignIn(evidence);
  await expect(panel.locator("[data-session-notice='true']")).toContainText("registered");
  // The credential really was created by the authenticator, not simulated by
  // the page: it is the virtual authenticator that now holds it.
  const credentials = await client.send("WebAuthn.getCredentials", {
    authenticatorId: authenticatorId(client),
  });
  expect(credentials.credentials.length).toBe(1);
  expect(credentials.credentials[0]?.rpId).toBe(PASSKEY_RELYING_PARTY_ID);
  await page.screenshot({ path: testInfo.outputPath("passkey-signed-in.png"), fullPage: true });

  await panel.locator("[data-session-sign-out='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  // Signing back in needs no invitation, no user name and nothing typed: the
  // credential is discoverable and the authority resolves the identity from it.
  await panel.locator("[data-session-passkey-sign-in='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  await expect(panel.locator("[data-session-identity] strong")).toHaveText(signedInUserId);
});

/*
 * Phase 99, in a real browser: the whole first-run path with no invitation
 * token anywhere in it. Giggle Band's own model declares `REGISTRATION
 * SELF_SERVICE`, so nothing here is faked — the harness reads the declaration
 * from `domain.adlj` through the same resolver the authority entrypoint uses.
 */
test("creates an account with no invitation, then creates a band from the empty state", async ({
  page,
  evidence,
}, testInfo) => {
  allowSignedOutStartup(evidence);
  const client = await addVirtualAuthenticator(page);

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  // Three routes, and the third one is new. `/readyz` is the only thing that
  // put it there.
  await expect(panel.locator("[data-session-passkey-sign-in='true']")).toBeVisible();
  await expect(panel.locator("[data-session-self-register='true']")).toBeVisible();
  await expect(panel.locator("[data-session-passkey-invite='true']")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("passkey-self-service-signed-out.png"),
    fullPage: true,
  });

  // Nothing typed: no invitation token, no user name, no account proof.
  await panel.locator("[data-session-self-register='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  const signedInUserId = await panel.locator("[data-session-identity] strong").innerText();
  expect(signedInUserId).toMatch(/^user-/u);
  await expect(panel.locator("[data-session-notice='true']")).toContainText(
    "Your account was created",
  );

  // The credential was produced by the authenticator and verified for real.
  const credentials = await client.send("WebAuthn.getCredentials", {
    authenticatorId: authenticatorId(client),
  });
  expect(credentials.credentials.length).toBe(1);
  expect(credentials.credentials[0]?.rpId).toBe(PASSKEY_RELYING_PARTY_ID);

  // And the room is not empty: the empty state is the entry point.
  const emptyState = page.locator("[data-empty-state='true']");
  await expect(emptyState).toContainText("No Band contexts are available for this view.");
  const createBand = emptyState.locator("[data-shell-command-control='createFirstBand']");
  await expect(createBand).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("passkey-self-service-empty-state.png"),
    fullPage: true,
  });

  await createBand.click();
  const form = page.locator("[data-command-form='CreateBand']");
  await expect(form).toBeVisible();
  await form.locator("[data-command-input='Name']").fill("The Newcomers");
  await page.screenshot({
    path: testInfo.outputPath("passkey-self-service-command-form.png"),
    fullPage: true,
  });
  await form.locator(".adl-command-form-submit").click();

  // Landed inside the band they just made: no reload, no re-sign-in.
  await expect(page.locator("[data-empty-state='true']")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("adl-app")).toContainText("The Newcomers");
  await expect(page.locator("[data-shell-command-control='createFirstBand']")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("passkey-self-service-first-band.png"),
    fullPage: true,
  });
});

test("refuses to sign in when the browser holds no credential, and issues no session", async ({
  page,
  evidence,
}) => {
  allowSignedOutStartup(evidence);
  await addVirtualAuthenticator(page);

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");

  await panel.locator("[data-session-passkey-sign-in='true']").click();

  // Whether the authenticator refuses or the authority does, the outcome is the
  // same and it is stated: still signed out, no session, no silent success.
  await expect(panel).toHaveAttribute("data-session-status", "signedOut");
  await expect(panel.locator("[data-session-identity]")).toHaveCount(0);

  // ...and the server agrees. The UI showing "signed out" is the client's
  // belief; this is the authority's own record that it refused, which is the
  // fact that actually matters and which no UI assertion can reach. Phase 99
  // shipped a control the server would have refused, and Phase 105 measured an
  // enabled Accept button that is silently refused; in both, only the
  // server-side record disambiguates.
  await expectAuthorityDenied(evidence, {
    event: /authority_request_rejected/u,
    endpoint: /\/v1\/session\/current/u,
    reason: /unauthenticated/u,
  });
  await expectNoRequestTo(evidence, /\/v1\/webauthn\/registration/u);
});

/*
 * The Phase 50 offline session states, in a real browser. None of this is
 * reachable from the `desktop`/`mobile` projects, which screenshot the reference
 * app with no authority configured; and none of it is provable in Node, because
 * what is under test is a real reload with real IndexedDB and a real network
 * failure rather than a stubbed transport.
 */
test("keeps the signed-in identity across an offline reload, then prompts once the grace lapses", async ({
  page,
  context,
  evidence,
}, testInfo) => {
  allowSignedOutStartup(evidence);
  await addVirtualAuthenticator(page);
  const inviteToken = await authority.invite();

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await panel.locator("[data-session-passkey-invite='true']").fill(inviteToken);
  await panel.locator("[data-session-register-passkey='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  const signedInUserId = await panel.locator("[data-session-identity] strong").innerText();

  /*
   * The authority is made unreachable rather than the whole context taken
   * offline: registration is production-only, so this project's dev server has
   * no service worker and a fully offline reload could not load the page at
   * all. Blocking the authority origin is the state under test anyway — the
   * page loads, and every call to the authority fails.
   */
  await context.route(`**://localhost:${authority.port}/**`, (route) => route.abort());
  // Measured in the Phase 107 inventory: aborting the authority origin produces
  // `net::ERR_FAILED` on `/readyz` and `/v1/sync/bootstrap`, and Chromium logs a
  // console error for each. Both are this test's subject, not defects.
  evidence.allow({
    reason:
      "the authority origin is deliberately made unreachable here; this test exists to prove the app keeps the signed-in identity when it is",
    requestUrl: new RegExp(`localhost:${authority.port}`, "u"),
  });
  evidence.allow({
    reason: "Chromium logs a console error for each request aborted by the deliberate route above",
    consoleText: /Failed to load resource: net::ERR_FAILED/u,
  });

  // The defect this phase closed: with no connection the app used to fall back
  // to the local demo identity, and the user's own cached data stopped
  // resolving for them.
  await page.reload();
  await expect(panel).toHaveAttribute("data-session-status", "unavailable");
  await expect(panel.locator("[data-session-identity] strong")).toHaveText(signedInUserId);
  await expect(panel.locator("[data-session-grace='withinGrace']")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("passkey-offline-within-grace.png"),
    fullPage: true,
  });

  // Age the cached authentication past the declared 30-day grace. This is the
  // only way to reach the state in a test: the grace is measured in weeks.
  await backdateLastVerified(page, 31);
  await page.reload();

  const expired = panel.locator("[data-session-grace='expired']");
  await expect(expired).toBeVisible();
  await expect(expired).toContainText("Syncing is paused");
  // It must not read as data loss, and it must not become a second way in.
  await expect(expired).toContainText("still works offline");
  await expect(panel.locator("[data-session-account-proof='true']")).toHaveCount(0);
  // Unreachable, so the deployment's identity mode is unknown and no ceremony
  // is offered here: there is nothing a ceremony could reach.
  await expect(expired.locator("[data-session-passkey-sign-in='true']")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("passkey-grace-expired.png"),
    fullPage: true,
  });

  // The app itself is untouched: local operation is never gated on the grace.
  await expect(page.locator("adl-app")).toBeVisible();

  /*
   * Reconnecting settles it, and the authority — not the client's belief about
   * its own grace — is what decides. Only the cached clock was aged here; the
   * server session was never revoked and is still inside its own 30-day
   * lifetime, so the reconnect authenticates, restarts the grace, and needs no
   * ceremony. A client that had lapsed for real would be answered
   * `unauthenticated` at this point instead and would land on the sign-in
   * surface, which is the case the real-PostgreSQL suite proves.
   */
  await context.unroute(`**://localhost:${authority.port}/**`);
  await page.reload();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
  await expect(panel.locator("[data-session-identity] strong")).toHaveText(signedInUserId);
  // The grace restarted from that contact, so nothing is paused any more.
  await expect(panel.locator("[data-session-grace]")).toHaveCount(0);
});

test("shows the signed-in person their own devices", async ({ page, evidence }, testInfo) => {
  allowSignedOutStartup(evidence);
  await addVirtualAuthenticator(page);
  const inviteToken = await authority.invite();

  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await panel.locator("[data-session-passkey-invite='true']").fill(inviteToken);
  await panel.locator("[data-session-register-passkey='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });

  const devices = page.locator("adl-session-devices");
  await expect(devices).toBeVisible();
  await devices.locator("[data-devices-refresh='true']").click();

  await expect(devices.locator(".adl-session-device")).toHaveCount(1);
  await expect(devices).toContainText("This device");
  // Ending the current session is signing out, so it offers no revoke of its
  // own. Revoking another device is proven over real PostgreSQL, where a second
  // session can actually exist.
  await expect(devices.locator("[data-devices-revoke]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("passkey-devices.png"), fullPage: true });
});

/**
 * Rewrites the cached authentication timestamp so the grace can be observed
 * lapsing without waiting weeks. Only the timestamp moves: the cached user id
 * is left exactly as the authority wrote it.
 */
async function backdateLastVerified(page: Page, days: number): Promise<void> {
  await page.evaluate(async (ageDays) => {
    const database = "adl-giggle-band-example-session-identity";
    const store = "sessionIdentity";
    const key = "__adl_session_identity";
    const db = await new Promise<IDBDatabase>((settle, fail) => {
      const open = indexedDB.open(database);
      open.onsuccess = () => settle(open.result);
      open.onerror = () => fail(open.error);
    });
    const read = db.transaction(store, "readonly").objectStore(store).get(key);
    const identity = await new Promise<{ userId: string; lastVerifiedAt: string }>(
      (settle, fail) => {
        read.onsuccess = () => settle(read.result as { userId: string; lastVerifiedAt: string });
        read.onerror = () => fail(read.error);
      },
    );
    const aged = {
      ...identity,
      lastVerifiedAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(),
    };
    await new Promise<void>((settle, fail) => {
      const write = db.transaction(store, "readwrite").objectStore(store).put(aged, key);
      write.onsuccess = () => settle();
      write.onerror = () => fail(write.error);
    });
    db.close();
  }, days);
}

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
