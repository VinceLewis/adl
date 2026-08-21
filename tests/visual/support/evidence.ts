/**
 * Per-test browser evidence: capture, and the review at the end of the test.
 *
 * Every test gets a folder — Playwright's own `testInfo.outputDir` — holding
 * `console.jsonl` (every level, not only crashes), `network.jsonl` (every
 * request, response and failure), `authority.jsonl` (the authority's own
 * security log for exactly this test, where one is running), `verdict.json`,
 * and its screenshots. Six gates then review it and fail the test on anything
 * unexplained. See `learnings/process/visual-browser-verification.md`.
 *
 * The `page` fixture is extended rather than `context`. Overriding `context`
 * would be the obvious way to get a HAR, and it is what the prior art does, but
 * it disables Playwright's built-in trace attachment — and `trace:
 * "retain-on-failure"` is this suite's only automatic failure artefact. JSONL
 * written from `page` events costs nothing and breaks nothing.
 *
 * The fixture is `auto`, so a spec that never destructures `evidence` is still
 * recorded and still reviewed. That is the point: the 59 tests that predate this
 * layer get the gates without being rewritten.
 */

import { test as base, type Page, type TestInfo } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAllowRuleIsUsable,
  renderFailureMessage,
  reviewEvidence,
  type AllowRule,
  type CaptureContext,
  type EvidenceDraft,
  type EvidenceEntry,
  type EvidenceVerdict,
  type ScopedAllowance,
} from "./evidence-core.js";
import { activeAuthorityRecorder } from "./authority-log.js";

export type { AllowRule } from "./evidence-core.js";

export interface Evidence {
  /** Allow a deliberate failure for the rest of this test. */
  allow(rule: AllowRule): void;
  /**
   * Allow deliberate failures only while `body` runs.
   *
   * Preferred over `allow`: it scopes the permission to the window in which the
   * test actually provokes the failure, so noise before or after still fails.
   */
  during<T>(rules: AllowRule[], body: () => Promise<T>): Promise<T>;
  /** Everything recorded so far, in order. */
  readonly entries: readonly EvidenceEntry[];
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly failedRequests: readonly EvidenceEntry[];
  readonly responses: readonly EvidenceEntry[];
  readonly authorityEvents: readonly EvidenceEntry[];
  /**
   * Stop the six gates from failing this test, permanently, for this test only.
   * Used by the self-check spec, which deliberately provokes failures in order
   * to assert on the verdict rather than to be judged by it. Never use it in a
   * real spec: that is what an allowance with a reason is for.
   */
  suspendGatesForSelfCheck(): void;
  /**
   * The verdict, computed on demand, so a test can assert on the review itself
   * rather than only be judged by it. `finalUrl` defaults to the recorded page.
   */
  review(finalUrl?: string, screenshots?: number): EvidenceVerdict;
  /**
   * Discard the recorded network stream, reproducing exactly the state the
   * empty-recorder gate exists to detect: a listener that silently stopped
   * recording while the page went on navigating. Self-check only.
   */
  simulateRecorderWiringFailure(): void;
}

class Recorder implements Evidence {
  readonly browserEntries: EvidenceEntry[] = [];
  private readonly allowances: ScopedAllowance[] = [];
  private seq = 0;
  private suspended = false;
  private authority: { recorder: { since(mark: number): unknown[] }; origin: string } | undefined;
  private authorityMark = 0;

  bindAuthority(): void {
    const active = activeAuthorityRecorder();
    if (active === undefined) return;
    this.authority = active;
    this.authorityMark = active.recorder.mark();
  }

  /**
   * The authority's slice for this test, materialised on demand.
   *
   * On demand rather than at teardown, so a test body can assert on what the
   * server actually recorded while it is still running — which is the whole
   * point of `expectAuthorityDenied` and
   * `expectAuthorityAcceptedAfterSignIn`. Materialising only at teardown made
   * every such assertion see an empty list; found by running one.
   */
  authoritySlice(): EvidenceEntry[] {
    if (this.authority === undefined) return [];
    const raw = this.authority.recorder.since(this.authorityMark) as {
      event: string;
      outcome: "allowed" | "denied" | "failed";
      endpoint?: string;
      status?: number;
      reason?: string;
    }[];
    return raw.map((event, index) => {
      const draft: Record<string, unknown> = {
        kind: "authority",
        seq: this.seq + index + 1,
        at: new Date().toISOString(),
        event: event.event,
        outcome: event.outcome,
        text: JSON.stringify(event),
      };
      if (event.endpoint !== undefined) draft["endpoint"] = event.endpoint;
      if (event.status !== undefined) draft["status"] = event.status;
      if (event.reason !== undefined) draft["reason"] = event.reason;
      return draft as unknown as EvidenceEntry;
    });
  }

  authorityOrigin(): string | undefined {
    return this.authority?.origin;
  }

  next(): number {
    this.seq += 1;
    return this.seq;
  }

  record(entry: EvidenceDraft): void {
    const stamped: Record<string, unknown> = { seq: this.next(), at: new Date().toISOString() };
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) stamped[key] = value;
    }
    this.browserEntries.push(stamped as unknown as EvidenceEntry);
  }

  allow(rule: AllowRule): void {
    assertAllowRuleIsUsable(rule);
    this.allowances.push({ rule, from: this.seq + 1 });
  }

  async during<T>(rules: AllowRule[], body: () => Promise<T>): Promise<T> {
    for (const rule of rules) assertAllowRuleIsUsable(rule);
    const opened = rules.map((rule): ScopedAllowance => ({ rule, from: this.seq + 1 }));
    this.allowances.push(...opened);
    try {
      return await body();
    } finally {
      for (const allowance of opened) allowance.to = this.seq;
    }
  }

  suspendGatesForSelfCheck(): void {
    this.suspended = true;
  }

  simulateRecorderWiringFailure(): void {
    for (let index = this.browserEntries.length - 1; index >= 0; index -= 1) {
      const kind = this.browserEntries[index]?.kind;
      if (kind === "request" || kind === "response" || kind === "requestfailed") {
        this.browserEntries.splice(index, 1);
      }
    }
  }

  get gatesSuspended(): boolean {
    return this.suspended;
  }

  get entries(): readonly EvidenceEntry[] {
    return [...this.browserEntries, ...this.authoritySlice()];
  }

  get pageErrors(): readonly string[] {
    return this.entries.filter((e) => e.kind === "pageerror").map((e) => e.text ?? "");
  }

  get consoleErrors(): readonly string[] {
    return this.entries
      .filter((e) => e.kind === "console" && (e.level === "error" || e.level === "severe"))
      .map((e) => e.text ?? "");
  }

  get failedRequests(): readonly EvidenceEntry[] {
    return this.entries.filter((e) => e.kind === "requestfailed");
  }

  get responses(): readonly EvidenceEntry[] {
    return this.entries.filter((e) => e.kind === "response");
  }

  get authorityEvents(): readonly EvidenceEntry[] {
    return this.entries.filter((e) => e.kind === "authority");
  }

  context(finalUrl: string): CaptureContext {
    const origin = this.authorityOrigin();
    return {
      finalUrl,
      authorityAttached: this.authority !== undefined,
      authorityRequestCount:
        origin === undefined
          ? 0
          : this.browserEntries.filter(
              (e) => e.kind === "request" && (e.url ?? "").startsWith(origin),
            ).length,
      authorityEventCount: this.authoritySlice().length,
    };
  }

  review(finalUrl = "", screenshots = 0): EvidenceVerdict {
    return reviewEvidence(this.entries, this.allowances, this.context(finalUrl), screenshots);
  }
}

/**
 * A test-only font override.
 *
 * `src/ui/styles.css` sets `--adl-font-family: system-ui, sans-serif`, which
 * fontconfig resolves differently on every host. Nothing depends on this today
 * — this suite has no pixel baselines — but pinning it here rather than in
 * production CSS removes the single largest flake source ahead of the phase
 * that adds them.
 */
const PINNED_TEST_FONT = `:root { --adl-font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif !important; }`;

function attachListeners(page: Page, recorder: Recorder): void {
  page.on("console", (message) => {
    const location = message.location();
    recorder.record({
      kind: "console",
      level: message.type(),
      text: message.text(),
      location:
        location.url === ""
          ? undefined
          : `${location.url}:${location.lineNumber}:${location.columnNumber}`,
    });
  });
  page.on("pageerror", (error) => {
    recorder.record({ kind: "pageerror", text: error.message, stack: error.stack });
  });
  page.on("request", (request) => {
    recorder.record({
      kind: "request",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    recorder.record({
      kind: "response",
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
    });
  });
  page.on("requestfailed", (request) => {
    recorder.record({
      kind: "requestfailed",
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });
}

function writeJsonl(path: string, entries: readonly unknown[]): void {
  writeFileSync(
    path,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length > 0 ? "\n" : ""),
  );
}

/** Screenshots already written by the spec into this test's own folder. */
function screenshotNames(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir).filter((name) => name.endsWith(".png"));
}

export const test = base.extend<{ evidence: Evidence }>({
  evidence: [
    async ({ page }, use, testInfo: TestInfo) => {
      const recorder = new Recorder();
      attachListeners(page, recorder);
      page.context().on("page", (extra) => attachListeners(extra, recorder));
      // An init script runs at document creation, before `documentElement`
      // exists, so the append is deferred to whichever of the two moments comes
      // first. Found by this layer's own page-error gate on its first run.
      await page.addInitScript((css: string) => {
        const inject = (): void => {
          const root = document.head ?? document.documentElement;
          if (root === null) return;
          const style = document.createElement("style");
          style.textContent = css;
          root.append(style);
        };
        if (document.documentElement === null) {
          document.addEventListener("DOMContentLoaded", inject, { once: true });
        } else {
          inject();
        }
      }, PINNED_TEST_FONT);

      recorder.bindAuthority();

      await use(recorder);

      // --- the review at the end of the test -------------------------------
      let finalUrl = "";
      try {
        finalUrl = page.url();
      } catch {
        /* page already closed — treated as "did not navigate" */
      }

      const outputDir = testInfo.outputDir;
      mkdirSync(outputDir, { recursive: true });
      const shots = screenshotNames(outputDir);
      const verdict = recorder.review(finalUrl, shots.length);

      const entries = recorder.entries;
      const hasAuthority = recorder.authorityOrigin() !== undefined;
      const consoleEntries = entries.filter(
        (entry) => entry.kind === "console" || entry.kind === "pageerror",
      );
      const networkEntries = entries.filter(
        (entry) =>
          entry.kind === "request" || entry.kind === "response" || entry.kind === "requestfailed",
      );
      const authorityEntries = entries.filter((entry) => entry.kind === "authority");

      writeJsonl(join(outputDir, "console.jsonl"), consoleEntries);
      writeJsonl(join(outputDir, "network.jsonl"), networkEntries);
      if (hasAuthority) writeJsonl(join(outputDir, "authority.jsonl"), authorityEntries);
      writeFileSync(join(outputDir, "verdict.json"), JSON.stringify(verdict, null, 2));

      await testInfo.attach("evidence-verdict", {
        body: JSON.stringify(verdict),
        contentType: "application/json",
      });
      await testInfo.attach("console.jsonl", {
        path: join(outputDir, "console.jsonl"),
        contentType: "application/x-ndjson",
      });
      await testInfo.attach("network.jsonl", {
        path: join(outputDir, "network.jsonl"),
        contentType: "application/x-ndjson",
      });
      if (hasAuthority) {
        await testInfo.attach("authority.jsonl", {
          path: join(outputDir, "authority.jsonl"),
          contentType: "application/x-ndjson",
        });
      }
      // Screenshots the spec wrote are attached here rather than at each call
      // site, so the report links every image without 31 edits — and so a
      // screenshot added later is indexed with no further wiring.
      for (const name of shots) {
        await testInfo.attach(name, { path: join(outputDir, name), contentType: "image/png" });
      }

      // `ADL_EVIDENCE_REPORT_ONLY=1` records and indexes without failing. It
      // exists for exactly one purpose: the inventory pass that establishes,
      // by running, what the suite actually emits — so allowances are written
      // against what was observed rather than what was predicted. It is never
      // how a run is made to pass.
      const reportOnly = process.env["ADL_EVIDENCE_REPORT_ONLY"] === "1";
      if (verdict.failures.length > 0 && !recorder.gatesSuspended && !reportOnly) {
        throw new Error(renderFailureMessage(verdict));
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
