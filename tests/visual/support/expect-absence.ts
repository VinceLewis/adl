/**
 * The negative half of a browser assertion, made cheap and made non-vacuous.
 *
 * `learnings/process/testing-expectations.md` requires a matching negative test
 * for every positive one, and warns that the easiest negative to write is the
 * one that would pass against a constant. In a browser spec the constant is a
 * blank page: `await expect(x).toHaveCount(0)` is satisfied equally by "the
 * control is correctly not offered", "the page never mounted" and "somebody
 * renamed the selector". These helpers make the discrimination structural.
 */

import { expect, type Locator } from "@playwright/test";
import type { Evidence } from "./evidence.js";
import { describeEntry, type EvidenceEntry } from "./evidence-core.js";

/**
 * `absent` matches nothing inside `within`, AND `present` matches something
 * inside it.
 *
 * The anchor is required, not optional. Without it the assertion cannot tell a
 * correct absence from a page that failed to render — which is exactly the
 * shape of vacuous negative the project rule warns about, and which this
 * repository already carried at `giggle-band.visual.spec.ts:476`.
 */
export async function expectAbsentWithin(scope: {
  within: Locator;
  absent: Locator;
  present: Locator;
  because: string;
}): Promise<void> {
  await expect(
    scope.present,
    `anchor missing, so the absence below would prove nothing: ${scope.because}`,
  ).toBeVisible();
  await expect(scope.absent, scope.because).toHaveCount(0);
}

/**
 * A request matching `url` was recorded, and was answered `status`.
 *
 * Distinguishes the two failure modes a bare `toHaveCount(0)` conflates:
 * a request that was never made at all (the affordance never fired — assert
 * that with `expectNoRequestTo`), and one that was answered 2xx (the thing you
 * expected to be refused was permitted, which is the defect).
 *
 * Also declares the allowance for the HTTP-error gate: a refusal you assert is
 * a refusal you expected, so it is not additionally reported as an unexplained
 * 4xx. That is why `reason` is required here too.
 */
export async function expectRequestRefused(
  evidence: Evidence,
  expected: { method?: string; url: RegExp; status: number; reason: string },
): Promise<void> {
  evidence.allow({
    reason: expected.reason,
    requestUrl: expected.url,
    status: expected.status,
  });
  const matching = evidence.responses.filter(
    (entry) =>
      expected.url.test(entry.url ?? "") &&
      (expected.method === undefined || entry.method === expected.method),
  );
  expect(
    matching.length,
    `no request matching ${expected.url} was recorded at all. A refusal you never attempted is not a refusal; use expectNoRequestTo if absence is what you meant.`,
  ).toBeGreaterThan(0);
  const statuses = matching.map((entry) => entry.status);
  expect(
    statuses,
    `expected ${expected.url} to be refused with ${expected.status}, got ${statuses.join(", ")}. A 2xx here means the thing you expected to be refused was permitted.`,
  ).toContain(expected.status);
}

/** No request matching `url` was made at all. Fails naming the entry if one was. */
export async function expectNoRequestTo(evidence: Evidence, url: RegExp): Promise<void> {
  const matching = evidence.entries.filter(
    (entry) => entry.kind === "request" && url.test(entry.url ?? ""),
  );
  expect(
    matching.map((entry) => describeEntry({ ...entry, kind: "response" } as EvidenceEntry)),
    `expected no request to ${url}, but the affordance fired`,
  ).toEqual([]);
}

/**
 * The authority itself recorded a denial during this test.
 *
 * The half a UI assertion can never reach. Phase 99 shipped a "create a band"
 * button offered to people who were not signed in, whose click the server would
 * have refused; Phase 105 measured Jointly Care rendering an enabled Accept
 * button that is silently refused. In both, the UI-side assertion and the
 * server-side fact disagree, and only the server-side one is the truth.
 *
 * Pair it with `expectAbsentWithin` — the control is not offered, *and* it
 * would be refused if it were.
 */
export async function expectAuthorityDenied(
  evidence: Evidence,
  expected: { event: RegExp; endpoint?: RegExp; reason?: RegExp },
): Promise<void> {
  const denials = evidence.authorityEvents.filter(
    (entry) =>
      entry.outcome === "denied" &&
      expected.event.test(entry.event ?? "") &&
      (expected.endpoint === undefined || expected.endpoint.test(entry.endpoint ?? "")) &&
      (expected.reason === undefined || expected.reason.test(entry.reason ?? "")),
  );
  const seen = evidence.authorityEvents.map(
    (entry) =>
      `${entry.event}/${entry.outcome}${entry.reason === undefined ? "" : `/${entry.reason}`}`,
  );
  expect(
    denials.length,
    `expected the authority to record a denial matching ${expected.event}. Recorded instead: ${seen.join(", ") || "(nothing)"}. If the server allowed the call, hiding the control in the UI is not enforcement.`,
  ).toBeGreaterThan(0);
}
