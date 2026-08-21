/**
 * The pure half of the browser evidence layer: types, allowance matching, gate
 * classification, and the run-index renderer.
 *
 * Nothing here imports Playwright, deliberately. Gate logic is a pure function
 * over a recorded buffer so `tests/visual-evidence.test.ts` can prove it in the
 * fast hermetic suite, where a case costs milliseconds rather than a browser.
 * The fixture in `evidence.ts` records and writes; it decides nothing.
 */

export type EvidenceKind =
  | "console"
  | "pageerror"
  | "request"
  | "response"
  | "requestfailed"
  | "authority";

/** One recorded observation. Ordering is by `seq`, which survives JSONL. */
export interface EvidenceEntry {
  kind: EvidenceKind;
  seq: number;
  at: string;
  /** console: the message type (`error`, `warning`, `log`, ...). */
  level?: string;
  text?: string;
  url?: string;
  method?: string;
  status?: number;
  failure?: string;
  stack?: string;
  location?: string;
  resourceType?: string;
  fromServiceWorker?: boolean;
  /** authority: the fields of `SecurityLogEvent` we index on. */
  event?: string;
  outcome?: "allowed" | "denied" | "failed";
  endpoint?: string;
  reason?: string;
}

/**
 * A declaration that a test provokes a failure on purpose.
 *
 * `reason` is not optional. An allowance is an annotation, not a silencer: the
 * reason is written into the evidence beside every entry it permits, so a
 * reader sees "12 failed requests, all allowed: <reason>" rather than a
 * silence. `npx tsc --noEmit` refuses an unexplained allowance.
 */
export interface AllowRule {
  reason: string;
  consoleText?: RegExp;
  pageError?: RegExp;
  requestUrl?: RegExp;
  status?: number;
  authorityEvent?: RegExp;
}

/** An `AllowRule` bound to the window of the test it applies to. */
export interface ScopedAllowance {
  rule: AllowRule;
  /** First `seq` this covers. */
  from: number;
  /** Last `seq` this covers, or `undefined` for the rest of the test. */
  to?: number;
}

export const GATE_NAMES = [
  "pageerror",
  "console-error",
  "request-failed",
  "http-error",
  "authority-failed",
  "empty-recorder",
] as const;
export type GateName = (typeof GATE_NAMES)[number];

/** Facts about the run that only the fixture knows, needed by gate 6. */
export interface CaptureContext {
  /** The page's URL when the test ended. */
  finalUrl: string;
  /** True when this project runs an in-process authority harness. */
  authorityAttached: boolean;
  /** Recorded network entries addressed to the authority origin. */
  authorityRequestCount: number;
  /** Recorded authority security-log events for this test. */
  authorityEventCount: number;
}

export interface GateHit {
  gate: GateName;
  entry?: EvidenceEntry;
  message: string;
}

export interface AllowedHit extends GateHit {
  reason: string;
}

export interface EvidenceVerdict {
  failures: GateHit[];
  allowed: AllowedHit[];
  unusedAllowances: { reason: string; matchers: string }[];
  counts: {
    console: Record<string, number>;
    requests: number;
    responses: number;
    requestsFailed: number;
    httpErrors: number;
    pageErrors: number;
    authorityAllowed: number;
    authorityDenied: number;
    authorityFailed: number;
    screenshots: number;
  };
  /**
   * Console warnings not covered by any allowance.
   *
   * Warnings never fail a test — `console.warn` is how this application
   * announces survivable degradation — but an *undeclared* one is worth a
   * human's eye. A declared one is not: the signed-out startup warning appears
   * in every authority test on every run, and a review section that lists it
   * every time trains people to skip the review section.
   */
  unexplainedWarnings: number;
}

/** An entry before it is stamped with its sequence and time. Optional fields may
 *  be explicitly `undefined`; `record` drops them rather than writing nulls. */
export type EvidenceDraft = { kind: EvidenceKind } & {
  [K in Exclude<keyof EvidenceEntry, "kind" | "seq" | "at">]?: EvidenceEntry[K] | undefined;
};

/** An `AllowRule` with no matcher covers everything, which is not an allowance
 *  but an exemption. Rejected at construction rather than at review time. */
export function assertAllowRuleIsUsable(rule: AllowRule): void {
  const hasMatcher =
    rule.consoleText !== undefined ||
    rule.pageError !== undefined ||
    rule.requestUrl !== undefined ||
    rule.status !== undefined ||
    rule.authorityEvent !== undefined;
  if (!hasMatcher) {
    throw new Error(
      `An allowance needs at least one matcher (consoleText, pageError, requestUrl, status or authorityEvent). Reason given: "${rule.reason}"`,
    );
  }
  if (rule.reason.trim() === "") {
    throw new Error("An allowance needs a non-empty reason.");
  }
}

/** Human-readable summary of what a rule matches, for the unused-allowance report. */
export function describeMatchers(rule: AllowRule): string {
  const parts: string[] = [];
  if (rule.consoleText) parts.push(`consoleText=${rule.consoleText}`);
  if (rule.pageError) parts.push(`pageError=${rule.pageError}`);
  if (rule.requestUrl) parts.push(`requestUrl=${rule.requestUrl}`);
  if (rule.status !== undefined) parts.push(`status=${rule.status}`);
  if (rule.authorityEvent) parts.push(`authorityEvent=${rule.authorityEvent}`);
  return parts.join(" ");
}

/**
 * Which gate, if any, an entry trips. Returns `undefined` for entries that are
 * recorded but never failed.
 *
 * `console.warn` is deliberately absent: `src/ui/session-startup.ts` and
 * `src/ui/authority-sync.ts` use `console.warn` as the application's designed
 * announcement of survivable degradation, and there is no `console.error`
 * anywhere in `src/`. Gating on `warn` would gate on the design. Likewise
 * `outcome: "denied"` is absent: a denial is the policy engine working.
 */
export function gateFor(entry: EvidenceEntry): GateName | undefined {
  if (entry.kind === "pageerror") return "pageerror";
  if (entry.kind === "console" && isConsoleErrorLevel(entry.level)) return "console-error";
  if (entry.kind === "requestfailed") return "request-failed";
  if (entry.kind === "response" && (entry.status ?? 0) >= 400) return "http-error";
  if (entry.kind === "authority" && entry.outcome === "failed") return "authority-failed";
  return undefined;
}

/** Chromium reports `console.error` as type `error`; some transports say `severe`. */
export function isConsoleErrorLevel(level: string | undefined): boolean {
  return level === "error" || level === "severe";
}

/** Does this allowance cover this entry? Window first, then kind-appropriate matcher. */
export function allowanceCovers(allowance: ScopedAllowance, entry: EvidenceEntry): boolean {
  // Authority events are sliced per test, not per moment: they come from the
  // server's own log, whose ordering against browser events inside one test is
  // not meaningful. Scoping them to a sub-window would be a false precision, so
  // an `authorityEvent` allowance covers the whole test wherever it is declared.
  if (entry.kind !== "authority") {
    if (entry.seq < allowance.from) return false;
    if (allowance.to !== undefined && entry.seq > allowance.to) return false;
  }
  const rule = allowance.rule;
  switch (entry.kind) {
    case "console":
      return rule.consoleText !== undefined && rule.consoleText.test(entry.text ?? "");
    case "pageerror":
      return rule.pageError !== undefined && rule.pageError.test(entry.text ?? "");
    case "requestfailed":
      // A rule that names a status is about a response that arrived. A request
      // that never got one is a different fact and needs its own allowance
      // saying so. Found by the Phase 107 gate-5 probe: the signed-out-startup
      // allowance ("answered 401") was silently also covering
      // `net::ERR_FAILED` on the same endpoints, which is not the same event.
      if (rule.status !== undefined) return false;
      return rule.requestUrl !== undefined && rule.requestUrl.test(entry.url ?? "");
    case "response": {
      const urlOk = rule.requestUrl === undefined || rule.requestUrl.test(entry.url ?? "");
      const statusOk = rule.status === undefined || rule.status === entry.status;
      // A rule naming neither a url nor a status says nothing about a response.
      if (rule.requestUrl === undefined && rule.status === undefined) return false;
      return urlOk && statusOk;
    }
    case "authority":
      return rule.authorityEvent !== undefined && rule.authorityEvent.test(entry.event ?? "");
    case "request":
    default:
      return false;
  }
}

/**
 * Review the recording. Pure: same input, same verdict, no I/O.
 *
 * Gate 6 (`empty-recorder`) is the negative half of the capture itself. A
 * recorder that silently stops recording makes every other gate pass forever
 * and invisibly — a listener attached to the wrong page, a fixture ordering
 * change, a Playwright event rename. This turns that state into a failure.
 */
export function reviewEvidence(
  entries: readonly EvidenceEntry[],
  allowances: readonly ScopedAllowance[],
  context: CaptureContext,
  screenshots = 0,
): EvidenceVerdict {
  const failures: GateHit[] = [];
  const allowed: AllowedHit[] = [];
  const used = new Set<ScopedAllowance>();

  for (const entry of entries) {
    const cover = allowances.find((allowance) => allowanceCovers(allowance, entry));
    // An allowance counts as used when it covers any recorded observation, not
    // only one that would otherwise have failed. Declaring an expected
    // `console.warn` is legitimate — warnings never fail — and marking that
    // allowance unused would report it for review on every run, which is the
    // same crying-wolf failure the declaration exists to prevent.
    if (cover !== undefined) used.add(cover);
    const gate = gateFor(entry);
    if (gate === undefined) continue;
    if (cover === undefined) {
      failures.push({ gate, entry, message: describeEntry(entry) });
    } else {
      allowed.push({ gate, entry, message: describeEntry(entry), reason: cover.rule.reason });
    }
  }

  const requests = entries.filter((entry) => entry.kind === "request").length;
  const navigated = context.finalUrl !== "" && context.finalUrl !== "about:blank";
  if (navigated && requests === 0) {
    failures.push({
      gate: "empty-recorder",
      message: `the page reached ${context.finalUrl} but the network recorder captured nothing; the capture is broken, not the app`,
    });
  }
  if (
    context.authorityAttached &&
    context.authorityRequestCount > 0 &&
    context.authorityEventCount === 0
  ) {
    failures.push({
      gate: "empty-recorder",
      message: `${context.authorityRequestCount} authority request(s) were made but the authority recorder captured no events`,
    });
  }

  const unexplainedWarnings = entries.filter(
    (entry) =>
      entry.kind === "console" &&
      (entry.level === "warning" || entry.level === "warn") &&
      !allowances.some((allowance) => allowanceCovers(allowance, entry)),
  ).length;

  return {
    failures,
    allowed,
    unexplainedWarnings,
    unusedAllowances: allowances
      .filter((allowance) => !used.has(allowance))
      .map((allowance) => ({
        reason: allowance.rule.reason,
        matchers: describeMatchers(allowance.rule),
      })),
    counts: {
      console: countConsoleLevels(entries),
      requests,
      responses: entries.filter((entry) => entry.kind === "response").length,
      requestsFailed: entries.filter((entry) => entry.kind === "requestfailed").length,
      httpErrors: entries.filter((entry) => entry.kind === "response" && (entry.status ?? 0) >= 400)
        .length,
      pageErrors: entries.filter((entry) => entry.kind === "pageerror").length,
      authorityAllowed: countAuthority(entries, "allowed"),
      authorityDenied: countAuthority(entries, "denied"),
      authorityFailed: countAuthority(entries, "failed"),
      screenshots,
    },
  };
}

function countAuthority(
  entries: readonly EvidenceEntry[],
  outcome: "allowed" | "denied" | "failed",
): number {
  return entries.filter((entry) => entry.kind === "authority" && entry.outcome === outcome).length;
}

function countConsoleLevels(entries: readonly EvidenceEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.kind !== "console") continue;
    const level = entry.level ?? "log";
    counts[level] = (counts[level] ?? 0) + 1;
  }
  return counts;
}

export function describeEntry(entry: EvidenceEntry): string {
  switch (entry.kind) {
    case "console":
      return `console.${entry.level}: ${entry.text ?? ""}${entry.location === undefined ? "" : ` (${entry.location})`}`;
    case "pageerror":
      return `uncaught: ${entry.text ?? ""}`;
    case "requestfailed":
      return `request failed: ${entry.method ?? ""} ${entry.url ?? ""} — ${entry.failure ?? "unknown"}`;
    case "response":
      return `HTTP ${entry.status}: ${entry.method ?? ""} ${entry.url ?? ""}`;
    case "authority":
      return `authority ${entry.event ?? ""} outcome=${entry.outcome ?? ""}${entry.reason === undefined ? "" : ` reason=${entry.reason}`}`;
    default:
      return JSON.stringify(entry);
  }
}

/** The message a failing test is given. Names every gate hit, with its entry. */
export function renderFailureMessage(verdict: EvidenceVerdict): string {
  const lines = [
    `Browser evidence review failed: ${verdict.failures.length} unexplained observation(s).`,
    "",
    "Each line below is either a real defect or a failure this test provokes on purpose.",
    'If it is deliberate, declare it where it happens with evidence.during([{ reason: "..." , ... }], ...).',
    "An allowance is never a way to make a genuine finding go away.",
    "",
  ];
  for (const failure of verdict.failures) {
    lines.push(`  [${failure.gate}] ${failure.message}`);
  }
  if (verdict.allowed.length > 0) {
    lines.push("", `Allowed (not failures), ${verdict.allowed.length}:`);
    for (const hit of verdict.allowed.slice(0, 5)) {
      lines.push(`  [${hit.gate}] ${hit.message}  <- allowed: ${hit.reason}`);
    }
    if (verdict.allowed.length > 5) lines.push(`  ... and ${verdict.allowed.length - 5} more`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The run index
// ---------------------------------------------------------------------------

export interface IndexRow {
  project: string;
  title: string;
  file: string;
  status: string;
  expected: boolean;
  folder: string;
  verdict: EvidenceVerdict | undefined;
}

/** Why a row is put in front of a human. Empty means nothing to review. */
export function reviewReasons(row: IndexRow): string[] {
  const reasons: string[] = [];
  if (row.verdict === undefined) {
    reasons.push("no evidence recorded");
    return reasons;
  }
  if (!row.expected) reasons.push(`unexpected ${row.status}`);
  for (const unused of row.verdict.unusedAllowances) {
    reasons.push(`unused allowance: ${unused.reason}`);
  }
  if (row.verdict.unexplainedWarnings > 0) {
    reasons.push(`${row.verdict.unexplainedWarnings} undeclared console warning(s)`);
  }
  if (row.verdict.allowed.length >= 20) {
    reasons.push(`${row.verdict.allowed.length} allowed failures`);
  }
  return reasons;
}

export function renderIndex(rows: readonly IndexRow[], startedAt: string): string {
  const review = rows
    .map((row) => ({ row, reasons: reviewReasons(row) }))
    .filter((entry) => entry.reasons.length > 0);

  const lines: string[] = [
    "# Browser test evidence",
    "",
    `_Run started ${startedAt}. ${rows.length} test${rows.length === 1 ? "" : "s"}._`,
    "",
    "Each row links to that test's own folder: `console.jsonl` (every level),",
    "`network.jsonl` (every request, response and failure), `authority.jsonl`",
    "(the authority's own security log for exactly this test), `verdict.json`,",
    "and its screenshots.",
    "",
    "## Review",
    "",
  ];

  if (review.length === 0) {
    lines.push("Nothing to review. No unexpected results, no unused allowances, no warnings.");
  } else {
    lines.push("| Test | Project | Why |", "|---|---|---|");
    for (const entry of review) {
      lines.push(
        `| [${escapeCell(entry.row.title)}](./${entry.row.folder}/) | ${escapeCell(entry.row.project)} | ${escapeCell(entry.reasons.join("; "))} |`,
      );
    }
  }

  lines.push(
    "",
    "## All tests",
    "",
    "| Test | Project | Status | Shots | Console err (unallowed/allowed) | Warn | Req failed | Non-2xx | Authority failed | Evidence |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
    const verdict = row.verdict;
    const consoleUnallowed =
      verdict?.failures.filter((hit) => hit.gate === "console-error").length ?? 0;
    const consoleAllowed =
      verdict?.allowed.filter((hit) => hit.gate === "console-error").length ?? 0;
    const warnings = verdict === undefined ? 0 : (verdict.counts.console["warning"] ?? 0);
    lines.push(
      `| [${escapeCell(row.title)}](./${row.folder}/) | ${escapeCell(row.project)} | ${row.status}${row.expected ? "" : " (unexpected)"} | ${verdict?.counts.screenshots ?? 0} | ${consoleUnallowed}/${consoleAllowed} | ${warnings} | ${verdict?.counts.requestsFailed ?? 0} | ${verdict?.counts.httpErrors ?? 0} | ${verdict?.counts.authorityFailed ?? 0} | [folder](./${row.folder}/) |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim();
}
