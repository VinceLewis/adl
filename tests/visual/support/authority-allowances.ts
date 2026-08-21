/**
 * Deliberate failures this application produces by design, declared once.
 *
 * Everything here was established by the Phase 107 inventory run — the suite
 * recorded with the gates in report-only mode — not by predicting what the
 * browser would emit. Three of the author's four predictions were wrong; these
 * are what actually happens.
 */

import { expect } from "@playwright/test";
import type { AllowRule, Evidence } from "./evidence.js";

/** The two endpoints an authority-configured page calls before anybody signs in. */
export const SIGNED_OUT_STARTUP_ENDPOINTS = /\/v1\/(session\/current|sync\/bootstrap)$/u;

/**
 * The signed-out startup exchange.
 *
 * Measured: every page in the `passkey` and `administration` projects loads
 * signed out, calls `POST /v1/session/current` and `POST /v1/sync/bootstrap`,
 * and is answered `401 unauthenticated` — by design. The authority's own log
 * agrees (`authority_request_rejected` / `denied` / `unauthenticated`), and the
 * app then warns "authority sync is unavailable; continuing with local data",
 * which is `session-startup.ts` announcing survivable degradation. Chromium
 * logs a console error for every non-2xx it fetches, which is why this covers
 * the console as well as the response.
 *
 * This is the application working, not a test provoking a failure — which is
 * why it is declared once here rather than copied into eight specs.
 *
 * It is deliberately narrow: exactly these two paths, exactly 401. A 401 on any
 * other endpoint, or any other status on these, still fails. And it is not
 * open-ended in effect: every test that uses it goes on to assert
 * `data-session-status="signedIn"`, so a deployment that answered 401 forever
 * would fail those assertions. `expectAuthorityAcceptedAfterSignIn` below makes
 * that pairing explicit rather than incidental.
 */
export function signedOutStartupAllowances(): AllowRule[] {
  const reason =
    "signed-out startup: the page calls /v1/session/current and /v1/sync/bootstrap before anybody has signed in, and the authority answers 401 unauthenticated by design";
  return [
    { reason, requestUrl: SIGNED_OUT_STARTUP_ENDPOINTS, status: 401 },
    { reason, consoleText: /Failed to load resource.*401 \(Unauthorized\)/u },
    // The warning the app emits in response: `session-startup.ts` announcing
    // that it is continuing with local data. Declared so the run index does not
    // list it for review on every run — an undeclared warning still does.
    {
      reason,
      consoleText: /ADL authority sync is unavailable; continuing with local data/u,
    },
  ];
}

export function allowSignedOutStartup(evidence: Evidence): void {
  for (const rule of signedOutStartupAllowances()) evidence.allow(rule);
}

/**
 * The positive half of the allowance above: the authority accepted a bootstrap
 * for this session, so the 401s really were the pre-sign-in ones.
 *
 * Without this, "401 on bootstrap is allowed" would be satisfied by an app that
 * never signs in at all — the vacuous shape the project's negative-test rule
 * warns about. This asserts on the server's own record of the exchange, which
 * no UI assertion can reach.
 */
export async function expectAuthorityAcceptedAfterSignIn(evidence: Evidence): Promise<void> {
  const accepted = evidence.authorityEvents.filter(
    (entry) => entry.outcome === "allowed" && (entry.endpoint ?? "").includes("/v1/sync/bootstrap"),
  );
  const seen = evidence.authorityEvents
    .filter((entry) => (entry.endpoint ?? "").includes("/v1/sync/bootstrap"))
    .map((entry) => `${entry.outcome}/${entry.status}`);
  expect(
    accepted.length,
    `expected the authority to have accepted at least one /v1/sync/bootstrap for this session. Recorded: ${seen.join(", ") || "(nothing)"}. If every bootstrap was refused, the sign-in did not really take.`,
  ).toBeGreaterThan(0);
}
