/**
 * The browser evidence layer's gate logic, proven hermetically.
 *
 * Gate classification is a pure function over a recorded buffer precisely so it
 * can be tested here, in milliseconds, rather than only through a browser. The
 * Playwright self-check (`tests/visual/evidence-self-check.spec.ts`) proves the
 * other half: that a fail verdict really turns a Playwright test red.
 *
 * Every case is paired. A positive-only suite here could not tell "the gate
 * fires correctly" from "the gate always fires", and a negative-only one could
 * not tell "correctly quiet" from "always quiet"
 * (`learnings/process/testing-expectations.md`).
 */

import { describe, expect, it } from "vitest";
import {
  allowanceCovers,
  assertAllowRuleIsUsable,
  gateFor,
  renderIndex,
  reviewEvidence,
  reviewReasons,
  type AllowRule,
  type CaptureContext,
  type EvidenceEntry,
  type IndexRow,
  type ScopedAllowance,
} from "./visual/support/evidence-core.js";

let sequence = 0;
function entry(partial: Partial<EvidenceEntry> & { kind: EvidenceEntry["kind"] }): EvidenceEntry {
  sequence += 1;
  return { seq: sequence, at: new Date(0).toISOString(), ...partial };
}

function scoped(rule: AllowRule, from = 0, to?: number): ScopedAllowance {
  return to === undefined ? { rule, from } : { rule, from, to };
}

const NAVIGATED: CaptureContext = {
  finalUrl: "http://127.0.0.1:5173/?demo=giggle-band",
  authorityAttached: false,
  authorityRequestCount: 0,
  authorityEventCount: 0,
};

describe("gate classification", () => {
  it("fires on the five failing signals", () => {
    expect(gateFor(entry({ kind: "pageerror", text: "boom" }))).toBe("pageerror");
    expect(gateFor(entry({ kind: "console", level: "error", text: "boom" }))).toBe("console-error");
    expect(gateFor(entry({ kind: "requestfailed", url: "http://x/" }))).toBe("request-failed");
    expect(gateFor(entry({ kind: "response", url: "http://x/", status: 404 }))).toBe("http-error");
    expect(gateFor(entry({ kind: "authority", event: "e", outcome: "failed" }))).toBe(
      "authority-failed",
    );
  });

  /**
   * The negative half, and the one that matters most. `console.warn` is how
   * `session-startup.ts` and `authority-sync.ts` announce survivable
   * degradation, and `outcome: "denied"` is the policy engine working. A gate
   * that fired on either would fail honestly-passing tests, so the quiet is
   * asserted rather than assumed.
   */
  it("stays quiet on the signals that are recorded but never failed", () => {
    expect(gateFor(entry({ kind: "console", level: "warning", text: "degraded" }))).toBeUndefined();
    expect(gateFor(entry({ kind: "console", level: "log", text: "hello" }))).toBeUndefined();
    expect(
      gateFor(entry({ kind: "console", level: "debug", text: "[vite] connected." })),
    ).toBeUndefined();
    expect(gateFor(entry({ kind: "authority", event: "e", outcome: "denied" }))).toBeUndefined();
    expect(gateFor(entry({ kind: "authority", event: "e", outcome: "allowed" }))).toBeUndefined();
    expect(gateFor(entry({ kind: "response", url: "http://x/", status: 204 }))).toBeUndefined();
    expect(gateFor(entry({ kind: "response", url: "http://x/", status: 399 }))).toBeUndefined();
    expect(gateFor(entry({ kind: "request", url: "http://x/" }))).toBeUndefined();
  });
});

describe("allowance matching", () => {
  it("covers each kind when the matcher names it", () => {
    expect(
      allowanceCovers(
        scoped({ reason: "r", consoleText: /boom/u }),
        entry({ kind: "console", level: "error", text: "boom" }),
      ),
    ).toBe(true);
    expect(
      allowanceCovers(
        scoped({ reason: "r", pageError: /boom/u }),
        entry({ kind: "pageerror", text: "boom" }),
      ),
    ).toBe(true);
    expect(
      allowanceCovers(
        scoped({ reason: "r", requestUrl: /\/x$/u }),
        entry({ kind: "requestfailed", url: "http://h/x" }),
      ),
    ).toBe(true);
    expect(
      allowanceCovers(
        scoped({ reason: "r", status: 404 }),
        entry({ kind: "response", url: "http://h/x", status: 404 }),
      ),
    ).toBe(true);
    expect(
      allowanceCovers(
        scoped({ reason: "r", authorityEvent: /boom/u }),
        entry({ kind: "authority", event: "boom", outcome: "failed" }),
      ),
    ).toBe(true);
  });

  it("does not cover a kind its matcher says nothing about", () => {
    // A console matcher must not silence a network failure, and vice versa.
    expect(
      allowanceCovers(
        scoped({ reason: "r", consoleText: /boom/u }),
        entry({ kind: "pageerror", text: "boom" }),
      ),
    ).toBe(false);
    expect(
      allowanceCovers(
        scoped({ reason: "r", pageError: /boom/u }),
        entry({ kind: "console", level: "error", text: "boom" }),
      ),
    ).toBe(false);
    expect(
      allowanceCovers(
        scoped({ reason: "r", consoleText: /.*/u }),
        entry({ kind: "requestfailed", url: "http://h/x" }),
      ),
    ).toBe(false);
  });

  it("does not cover a different status, url or text", () => {
    expect(
      allowanceCovers(
        scoped({ reason: "r", status: 404 }),
        entry({ kind: "response", url: "http://h/x", status: 500 }),
      ),
    ).toBe(false);
    expect(
      allowanceCovers(
        scoped({ reason: "r", requestUrl: /\/a$/u }),
        entry({ kind: "requestfailed", url: "http://h/b" }),
      ),
    ).toBe(false);
    expect(
      allowanceCovers(
        scoped({ reason: "r", consoleText: /alpha/u }),
        entry({ kind: "console", level: "error", text: "beta" }),
      ),
    ).toBe(false);
  });

  /**
   * A rule naming a status is a claim about a response that arrived. Before
   * this, the signed-out-startup allowance ("these two endpoints answer 401")
   * silently also covered `net::ERR_FAILED` on the same endpoints — a request
   * that never got an answer at all, which is a different fact. Found by the
   * gate-5 probe in Phase 107.
   */
  it("does not let a status rule cover a request that never got a response", () => {
    const rule = { reason: "answered 401", requestUrl: /\/v1\/session\/current$/u, status: 401 };
    expect(
      allowanceCovers(
        scoped(rule),
        entry({ kind: "response", url: "http://h/v1/session/current", status: 401 }),
      ),
    ).toBe(true);
    expect(
      allowanceCovers(
        scoped(rule),
        entry({ kind: "requestfailed", url: "http://h/v1/session/current" }),
      ),
    ).toBe(false);
  });

  it("covers inside its window and not outside it", () => {
    const rule = { reason: "r", consoleText: /boom/u };
    const inside = entry({ kind: "console", level: "error", text: "boom" });
    const outside = entry({ kind: "console", level: "error", text: "boom" });
    const window = scoped(rule, inside.seq, inside.seq);
    expect(allowanceCovers(window, inside)).toBe(true);
    expect(allowanceCovers(window, outside)).toBe(false);
  });

  it("refuses a rule with no matcher, and a rule with an empty reason", () => {
    expect(() => assertAllowRuleIsUsable({ reason: "because" })).toThrow(/at least one matcher/u);
    expect(() => assertAllowRuleIsUsable({ reason: "  ", consoleText: /x/u })).toThrow(
      /non-empty reason/u,
    );
    expect(() => assertAllowRuleIsUsable({ reason: "because", consoleText: /x/u })).not.toThrow();
  });
});

describe("reviewEvidence", () => {
  it("fails an unallowed signal and reports an allowed one with its reason", () => {
    const bad = entry({ kind: "console", level: "error", text: "real defect" });
    const declared = entry({ kind: "console", level: "error", text: "on purpose" });
    const verdict = reviewEvidence(
      [entry({ kind: "request", url: "http://h/" }), bad, declared],
      [scoped({ reason: "this test provokes it", consoleText: /on purpose/u })],
      NAVIGATED,
    );
    expect(verdict.failures.map((hit) => hit.entry?.text)).toEqual(["real defect"]);
    expect(verdict.allowed.map((hit) => hit.reason)).toEqual(["this test provokes it"]);
    // The count is reported, not zeroed: a reader sees two console errors, one
    // of them explained — never a silence.
    expect(verdict.counts.console["error"]).toBe(2);
  });

  it("reports an allowance that matched nothing, without failing", () => {
    const verdict = reviewEvidence(
      [entry({ kind: "request", url: "http://h/" })],
      [scoped({ reason: "this no longer happens", consoleText: /gone/u })],
      NAVIGATED,
    );
    expect(verdict.failures).toEqual([]);
    expect(verdict.unusedAllowances).toEqual([
      { reason: "this no longer happens", matchers: "consoleText=/gone/u" },
    ]);
  });

  describe("the empty-recorder gate", () => {
    it("fails when the page navigated and no network was recorded", () => {
      const verdict = reviewEvidence([], [], NAVIGATED);
      expect(verdict.failures.map((hit) => hit.gate)).toEqual(["empty-recorder"]);
      expect(verdict.failures[0]?.message).toContain("the capture is broken, not the app");
    });

    it("does not fire when the page never navigated, or when the recorder worked", () => {
      expect(reviewEvidence([], [], { ...NAVIGATED, finalUrl: "about:blank" }).failures).toEqual(
        [],
      );
      expect(
        reviewEvidence([entry({ kind: "request", url: "http://h/" })], [], NAVIGATED).failures,
      ).toEqual([]);
    });

    it("fails when authority requests were made but no authority events recorded", () => {
      const verdict = reviewEvidence([entry({ kind: "request", url: "http://h/" })], [], {
        ...NAVIGATED,
        authorityAttached: true,
        authorityRequestCount: 4,
        authorityEventCount: 0,
      });
      expect(verdict.failures.map((hit) => hit.gate)).toEqual(["empty-recorder"]);
    });

    it("does not fire when the authority recorder produced events", () => {
      const verdict = reviewEvidence([entry({ kind: "request", url: "http://h/" })], [], {
        ...NAVIGATED,
        authorityAttached: true,
        authorityRequestCount: 4,
        authorityEventCount: 4,
      });
      expect(verdict.failures).toEqual([]);
    });
  });
});

describe("the run index", () => {
  const cleanRow = (): IndexRow => ({
    project: "desktop",
    title: "a clean test",
    file: "x.spec.ts",
    status: "passed",
    expected: true,
    folder: "x-a-clean-test-desktop",
    verdict: reviewEvidence([entry({ kind: "request", url: "http://h/" })], [], NAVIGATED),
  });

  it("puts a noisy test in the review section, naming why", () => {
    const row = cleanRow();
    row.verdict = reviewEvidence(
      [
        entry({ kind: "request", url: "http://h/" }),
        entry({ kind: "console", level: "warning", text: "degraded" }),
      ],
      [scoped({ reason: "stale allowance", consoleText: /never/u })],
      NAVIGATED,
    );
    expect(reviewReasons(row)).toEqual([
      "unused allowance: stale allowance",
      "1 undeclared console warning(s)",
    ]);
    expect(renderIndex([row], "now")).toContain("unused allowance: stale allowance");
  });

  /**
   * A warning the spec declared is expected noise, not news. The signed-out
   * startup warning appears in every authority test on every run; listing it
   * for review each time is how a review section stops being read.
   */
  it("does not review a warning the spec declared, but does review an undeclared one", () => {
    const declared = cleanRow();
    declared.verdict = reviewEvidence(
      [
        entry({ kind: "request", url: "http://h/" }),
        entry({ kind: "console", level: "warning", text: "sync unavailable" }),
      ],
      [scoped({ reason: "by design when signed out", consoleText: /sync unavailable/u })],
      NAVIGATED,
    );
    expect(declared.verdict.unexplainedWarnings).toBe(0);
    expect(reviewReasons(declared)).toEqual([]);

    const undeclared = cleanRow();
    undeclared.verdict = reviewEvidence(
      [
        entry({ kind: "request", url: "http://h/" }),
        entry({ kind: "console", level: "warning", text: "something new" }),
      ],
      [scoped({ reason: "by design when signed out", consoleText: /sync unavailable/u })],
      NAVIGATED,
    );
    expect(undeclared.verdict.unexplainedWarnings).toBe(1);
    expect(reviewReasons(undeclared)).toContain("1 undeclared console warning(s)");
    // ...and the allowance that did explain a warning is not additionally
    // reported as unused, which would be the same noise wearing a different hat.
    expect(undeclared.verdict.unusedAllowances.map((a) => a.reason)).toEqual([
      "by design when signed out",
    ]);
    expect(declared.verdict.unusedAllowances).toEqual([]);
  });

  it("says there is nothing to review on a clean run, rather than always listing something", () => {
    const row = cleanRow();
    expect(reviewReasons(row)).toEqual([]);
    const markdown = renderIndex([row], "now");
    expect(markdown).toContain("Nothing to review.");
    expect(markdown).toContain("a clean test");
  });

  it("flags an unexpected result even when the evidence itself is clean", () => {
    const row = { ...cleanRow(), status: "failed", expected: false };
    expect(reviewReasons(row)).toEqual(["unexpected failed"]);
  });
});
