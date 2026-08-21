/**
 * The gates prove they can fail — permanently, not once.
 *
 * A gate that has never been seen red is not a gate, and a gate proven red once
 * by a probe that was then deleted is a gate whose failure mode is unprotected
 * from the next refactor. Each case below provokes one gate's signal with no
 * allowance and is marked `test.fail()`, so Playwright *requires* it to fail:
 * delete or weaken that gate and the case becomes an **unexpected pass**, which
 * turns the suite red.
 *
 * Each is paired with a case proving the same signal, declared with an
 * allowance, passes and is recorded with its reason. A gate that always fails is
 * as useless as one that never does; only the pair pins the boundary
 * (`learnings/process/testing-expectations.md`).
 *
 * Measured before this file was trusted (Phase 107, Task 3): `test.fail()` does
 * cover a failure raised in *fixture teardown* rather than in the test body,
 * which is where the review happens.
 */

import { expect, test } from "./support/evidence.js";
import type { Page } from "@playwright/test";

const SELF_CHECK_URL = "/?demo=giggle-band";
const MISSING_PATH = "/__evidence_self_check_missing.json";

async function openApp(page: Page): Promise<void> {
  await page.goto(SELF_CHECK_URL);
  await page.locator("adl-app").waitFor({ state: "attached" });
}

/** Give the browser a beat to deliver an asynchronously-reported observation. */
async function settleObservation(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

// --- gate: console-error ----------------------------------------------------

test.describe("gate console-error", () => {
  test.fail();
  test("an unallowed console error fails the test", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => console.error("evidence-self-check: unallowed console error"));
    await settleObservation(page);
  });
});

test("an allowed console error passes and is recorded with its reason", async ({
  page,
  evidence,
}) => {
  await openApp(page);
  await evidence.during(
    [{ reason: "self-check probe", consoleText: /evidence-self-check/u }],
    async () => {
      await page.evaluate(() => console.error("evidence-self-check: allowed console error"));
      await settleObservation(page);
    },
  );
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(verdict.allowed.map((hit) => hit.reason)).toContain("self-check probe");
  expect(verdict.allowed.some((hit) => hit.gate === "console-error")).toBe(true);
});

test("an allowance does not reach outside its window", async ({ page, evidence }) => {
  await openApp(page);
  await evidence.during(
    [{ reason: "self-check probe", consoleText: /evidence-self-check/u }],
    async () => {
      await page.evaluate(() => console.error("evidence-self-check: inside the window"));
      await settleObservation(page);
    },
  );
  // Same text, after the window closed. The gate must fire on it.
  await page.evaluate(() => console.error("evidence-self-check: outside the window"));
  await settleObservation(page);
  evidence.suspendGatesForSelfCheck();
  const verdict = evidence.review(page.url());
  expect(verdict.failures.map((hit) => hit.message).join("\n")).toContain("outside the window");
  expect(verdict.failures.map((hit) => hit.message).join("\n")).not.toContain("inside the window");
});

// --- gate: pageerror --------------------------------------------------------

test.describe("gate pageerror", () => {
  test.fail();
  test("an unallowed uncaught exception fails the test", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      window.setTimeout(() => {
        throw new Error("evidence-self-check: unallowed uncaught exception");
      }, 0);
    });
    await settleObservation(page);
  });
});

test("an allowed uncaught exception passes", async ({ page, evidence }) => {
  await openApp(page);
  await evidence.during(
    [{ reason: "self-check probe", pageError: /evidence-self-check/u }],
    async () => {
      await page.evaluate(() => {
        window.setTimeout(() => {
          throw new Error("evidence-self-check: allowed uncaught exception");
        }, 0);
      });
      await settleObservation(page);
    },
  );
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(verdict.allowed.some((hit) => hit.gate === "pageerror")).toBe(true);
});

// --- gate: request-failed ---------------------------------------------------

test.describe("gate request-failed", () => {
  test.fail();
  test("an unallowed failed request fails the test", async ({ page, evidence }) => {
    await openApp(page);
    // The console error Chromium logs for the abort is allowed on purpose, so
    // the ONLY unallowed signal left is the failed request itself. Without this
    // the case would still fail with the request-failed gate deleted — the
    // console gate would cover it — and it would prove nothing about this gate.
    // Found by the mutation check, which is the point of running one.
    evidence.allow({
      reason: "self-check: isolate the request-failed gate from the console gate",
      consoleText: /Failed to load resource/u,
    });
    await page.route(`**${MISSING_PATH}`, (route) => route.abort());
    await page.evaluate((path: string) => fetch(path).catch(() => undefined), MISSING_PATH);
    await settleObservation(page);
  });
});

test("an allowed failed request passes", async ({ page, evidence }) => {
  await openApp(page);
  await page.route(`**${MISSING_PATH}`, (route) => route.abort());
  await evidence.during(
    [
      { reason: "self-check probe", requestUrl: /__evidence_self_check_missing/u },
      { reason: "self-check probe", consoleText: /Failed to load resource/u },
    ],
    async () => {
      await page.evaluate((path: string) => fetch(path).catch(() => undefined), MISSING_PATH);
      await settleObservation(page);
    },
  );
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(verdict.allowed.some((hit) => hit.gate === "request-failed")).toBe(true);
});

// --- gate: http-error -------------------------------------------------------

test.describe("gate http-error", () => {
  test.fail();
  test("an unallowed non-2xx response fails the test", async ({ page, evidence }) => {
    await openApp(page);
    // Same isolation as the request-failed case above, and for the same reason.
    evidence.allow({
      reason: "self-check: isolate the http-error gate from the console gate",
      consoleText: /Failed to load resource/u,
    });
    await page.route(`**${MISSING_PATH}`, (route) =>
      route.fulfill({ status: 404, body: "{}", contentType: "application/json" }),
    );
    await page.evaluate((path: string) => fetch(path).catch(() => undefined), MISSING_PATH);
    await settleObservation(page);
  });
});

test("an allowed non-2xx response passes and keeps its status in the evidence", async ({
  page,
  evidence,
}) => {
  await openApp(page);
  await page.route(`**${MISSING_PATH}`, (route) =>
    route.fulfill({ status: 404, body: "{}", contentType: "application/json" }),
  );
  await evidence.during(
    [
      {
        reason: "self-check probe",
        requestUrl: /__evidence_self_check_missing/u,
        status: 404,
      },
      { reason: "self-check probe", consoleText: /Failed to load resource/u },
    ],
    async () => {
      await page.evaluate((path: string) => fetch(path).catch(() => undefined), MISSING_PATH);
      await settleObservation(page);
    },
  );
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(
    verdict.allowed.some((hit) => hit.gate === "http-error" && hit.entry?.status === 404),
  ).toBe(true);
});

test("an allowance for one status does not cover a different one", async ({ page, evidence }) => {
  await openApp(page);
  await page.route(`**${MISSING_PATH}`, (route) =>
    route.fulfill({ status: 500, body: "{}", contentType: "application/json" }),
  );
  evidence.allow({
    reason: "self-check probe: 404 only",
    requestUrl: /__evidence_self_check_missing/u,
    status: 404,
  });
  evidence.allow({ reason: "self-check probe", consoleText: /Failed to load resource/u });
  await page.evaluate((path: string) => fetch(path).catch(() => undefined), MISSING_PATH);
  await settleObservation(page);
  evidence.suspendGatesForSelfCheck();
  const verdict = evidence.review(page.url());
  expect(verdict.failures.some((hit) => hit.gate === "http-error")).toBe(true);
  expect(verdict.unusedAllowances.map((entry) => entry.reason)).toContain(
    "self-check probe: 404 only",
  );
});

// --- gate: empty-recorder ---------------------------------------------------

test.describe("gate empty-recorder", () => {
  test.fail();
  test("a navigated page whose network recorder captured nothing fails the test", async ({
    page,
    evidence,
  }) => {
    await openApp(page);
    // Reproduces a listener that silently stopped recording. Without this gate
    // that state makes every other gate pass forever and invisibly.
    evidence.simulateRecorderWiringFailure();
  });
});

test("a navigated page with a working recorder passes", async ({ page, evidence }) => {
  await openApp(page);
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(verdict.counts.requests).toBeGreaterThan(0);
});

// --- the index's own review signal -------------------------------------------

test("an allowance that matched nothing is reported without failing the test", async ({
  page,
  evidence,
}) => {
  await openApp(page);
  evidence.allow({
    reason: "self-check: an allowance that deliberately matches nothing",
    consoleText: /this-string-is-never-logged-by-anything/u,
  });
  const verdict = evidence.review(page.url());
  expect(verdict.failures).toEqual([]);
  expect(verdict.unusedAllowances.map((entry) => entry.reason)).toContain(
    "self-check: an allowance that deliberately matches nothing",
  );
});
