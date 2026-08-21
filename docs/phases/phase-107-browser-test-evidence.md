# Phase 107 — Per-Test Browser Evidence, Captured and Checked

The Playwright suite takes 31 screenshots that **nothing compares**, listens for
uncaught exceptions in 4 of its 7 spec files and asserts only a single negative
string against them, captures **no** console output at any level, captures **no**
network activity at all, and discards the authority server's own structured
security log into interleaved worker stdout that no test owns. Every claim in
that sentence was measured (see Evidence). The suite therefore proves that a page
rendered *something*; it does not prove the page rendered without erroring, and
it cannot say what the server did while it happened.

This phase gives every test a folder of evidence, and — the half that matters —
decides what is **checked automatically at the end of that test** versus what a
human reviews from an index. Evidence nobody reads is not evidence, and a
capture pipeline that silently records nothing passes every "did the test pass?"
check ever written. Both halves are specified here, in pairs.

## Objective

Every Playwright test ends with a folder containing its screenshots, its full
browser console (all levels), its uncaught page errors, its complete network
activity including failures and non-2xx responses, and — where an authority is
running — that authority's own structured security log for exactly that test's
requests.

Six of those streams are **asserted at the end of the test**, so an unexplained
console error, uncaught exception, failed request, 4xx/5xx, server-side failure,
or a *silently empty recorder* fails the test that produced it. Failures a test
provokes on purpose are declared in the spec, in place, each with a written
reason recorded beside the entry it permits.

The phase also gives specs a **first-class way to write the negative half** of a
browser assertion — an affordance that must be absent, a request that must be
refused with a named status, a denial the server must actually have recorded —
so that the rule in `learnings/process/testing-expectations.md` is cheap to obey
rather than a chore, and so a negative assertion cannot be satisfied by a blank
page.

The run ends by writing `test-results/visual/EVIDENCE.md`: one row per test, with
a "review these" section on top. `AGENTS.md`'s standing instruction stops being
"inspect the screenshots" and becomes "read the index, then inspect what it
points at."

## Evidence and Dependency

Measured against this worktree (`phase-107-test-evidence`, based on `main` at
`8be0956`; `main` has since advanced to `50701a9` with a documentation-only
change that this branch merges cleanly) by reading and grepping the actual
sources. **Playwright was not run** — the suite binds fixed ports
5173/4173/5273/5373 with `reuseExistingServer: true` and other agents held those
ports during planning. Every claim below is a static fact about the source. The
claims that are *about* runtime behaviour are marked **inferred**; Task 0 and
Task 3 exist to measure them before anything is built on them.

### 1. Screenshots exist; nothing compares them

- `grep -rn "toHaveScreenshot" . --exclude-dir=node_modules` returns **0**. No
  baselines, no `*-snapshots/` directory, no comparison anywhere.
- **31 `page.screenshot(...)` call sites** across the 7 spec files. **22** already
  use `testInfo.outputPath(...)`, which resolves under `outputDir` +
  `/<file>-<title>-<project>/` — a per-test directory already exists for those.
  **9** are in `tests/visual/passkey-sign-in.spec.ts` and are hard-coded to
  `test-results/visual/<name>.png`, the root of `outputDir`, shared across every
  test and project.
- `page.screenshot({ path })` writes a file; it does **not** attach the image, so
  none of the 31 appears in the HTML report, in `result.attachments`, or in
  anything a reporter can index.
- `CLAUDE.md` and `AGENTS.md` both instruct a human to look at them. That is the
  entire check.

**Correction to the framing this phase was commissioned under:** it is not true
that screenshots are written ad hoc to a flat directory — 22 of 31 are already
per-test. The gap is that they are unattached, unindexed and uncompared, and that
one spec file writes to a shared root.

### 2. Console output is not captured; page errors are captured narrowly

- `page.on("pageerror", …)` appears in exactly 4 files
  (`browser-demo:37`, `jointly-care:46`, `startup-failure-recovery:37`,
  `giggle-band:47`), each pushing `error.message` into a local array.
- No spec asserts "no page errors". Every assertion on those arrays is the same
  single negative containment check, e.g.
  `expect(pageErrors).not.toEqual(expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]))`.
  An uncaught `TypeError` in any of the 59 test cases passes today.
- `page.on("console", …)` appears **nowhere** in `tests/`. `console.error`,
  `warn`, `info` and `log` are captured nowhere and asserted nowhere.

### 3. Network activity is not captured at all

`grep -rn 'requestfailed|recordHar|\.on\("response"' tests/` returns **0**. No
HAR, no request log, no failed-request handler, no status check. The only network
artefact that survives is inside `trace.zip`, and `trace: "retain-on-failure"`
means it exists only for tests that already failed.

### 4. The authority's own log is real, structured, redacted — and thrown away

The finding that most changes the shape of the solution, and it contradicts the
premise the phase was commissioned under.

- The `passkey` and `administration` projects do **not** spawn an authority
  process. `tests/visual/passkey-authority.ts:1` and
  `administration-authority.ts:1` both `createServer` from `node:http` **inside
  the Playwright worker**, in `test.beforeAll` (`passkey-sign-in.spec.ts:23`,
  `administration.spec.ts:31`). There is no subprocess, no stdout to tail and no
  log file to slice.
- `createAuthorityHttpHandler` already accepts an injectable logger and metrics:
  `src/server/authority-http.ts:60-61` (`logger?: SecurityLogger; metrics?:
  AuthorityMetrics`), defaulted at 77-78. Neither harness passes either
  (`grep -n "logger|metrics" tests/visual/*.ts` returns nothing), so both get
  `new StructuredSecurityLogger()`, whose default sink is `console.info`
  (`security-operations.ts:19`). The authority's log is being emitted right now,
  as JSON lines, into the worker's stdout, interleaved with the `list` reporter
  and attributed to no test.
- That logger already redacts structurally: `redactSecurityData`
  (`security-operations.ts:25-37`) replaces the value of any key matching
  `/(?:token|cookie|authorization|proof|password|secret|record|payload)/iu` with
  `[REDACTED]`. Capturing it introduces no new secret-leak surface.
- `SecurityLogEvent.outcome` is `"allowed" | "denied" | "failed"`
  (`security-operations.ts:5`). `denied` is the policy engine working; `failed`
  is a server-side error. Nothing anywhere distinguishes them today — and
  **`denied` is exactly the fact a browser negative test needs and cannot
  currently reach.**
- Both harnesses wrap the handler in `try { … } catch { outgoing.writeHead(500,
  …) }` with an **empty catch** (`passkey-authority.ts:180-183`,
  `administration-authority.ts:216-219`). A genuine unhandled exception becomes
  an opaque `{"error":"internal_error"}`, the stack trace is destroyed, and the
  browser sees a 500 no test checks for.

**Correction:** "server logs are not captured" understates it in one direction
and overstates it in another. There is no log *file*, because the server is
in-process; but there is a richer, already-redacted structured event stream
available by passing one constructor argument — and it carries the server's own
verdict on every request.

### 5. `src/index.ts` needs no change

`src/index.ts:102` is `export * from "./server/security-operations.js";`, so
`SecurityLogger` and `SecurityLogEvent` are already reachable from the barrel.
The repository's most contended serial-spine file is untouched by this phase.

### 6. What the suite actually is

- 5 projects (`desktop`, `mobile`, `offline-shell`, `passkey`, `administration`)
  over 4 web servers, `fullyParallel: false`, `outputDir: "test-results/visual"`,
  `trace: "retain-on-failure"`, reporters `list` + `html`.
- **59 test cases**, by count of the `test(...)` sites and their loops: `desktop`
  and `mobile` each run 25 (giggle 16, jointly 6, browser-demo 1, startup 2),
  plus `offline-shell` 1, `passkey` 5, `administration` 3.
- `test-results/` and `playwright-report/` are already in `.gitignore`.

### 7. Deliberate failure paths — the allowlist problem, enumerated

Static sites that provoke a failure on purpose. The sites are certain from the
source; their *observable consequences* are **inferred**, because only a run can
confirm what Chromium reports.

| Spec | Line | What it does on purpose | Expected unallowed signal (**inferred**) |
|---|---|---|---|
| `offline-shell.spec.ts` | 84 | `context.setOffline(true)` then `page.reload()` | `requestfailed` for anything the worker does not serve; Chromium logs each as a console `error` |
| `passkey-sign-in.spec.ts` | 190 | `context.route("**://localhost:8788/**", r => r.abort())`, then two reloads | many `requestfailed`; `console.warn` from `authority-sync.ts` and `session-startup.ts` |
| `passkey-sign-in.spec.ts` | 144 | signs in with no credential present | a 4xx from the authority, or an authenticator-side refusal |
| `startup-failure-recovery.visual.spec.ts` | 121 | `addInitScript` makes `indexedDB.open` **throw** | an uncaught page error, by construction |
| `startup-failure-recovery.visual.spec.ts` | 33 | same-version / mismatched-fingerprint metadata → `RuntimeStartupError` | a page error or a console error from the startup fallback path |
| `administration.spec.ts` | 51 | drives the "no context selected → unavailable" surface | possibly a non-2xx from the authority |

A blanket "no console errors, no failed requests" rule would fail **at least 4 of
the 7 spec files** on their first run, all honestly passing today. Designed for
from the start — see Decision C — not discovered late.

### 8. `console.warn` is the application's designed degradation channel

`grep` finds exactly 7 `console.warn` sites in `src/ui` (`session-startup.ts:67`,
`authority-sync.ts:136,501,814,827,846,903`) and **zero `console.error` anywhere
in `src/`**. `session-startup.ts:66-70` warns and returns `undefined` when
authority sync is unavailable — "continuing with local data". Warning is how this
application *says* it degraded. Gating on `warn` would gate on the design.

### 9. Baseline screenshots — the flake surface, measured

Facts that make pixel comparison **more** feasible than assumed:

- Seed data is date-pinned, not clock-derived. `src/reference/band-app.ts:17`
  pins `now: new Date("2026-07-07T08:00:00.000Z")` and every seeded date is a
  literal. `src/reference/giggle-band/ui.adlj:526,958` pin the calendar's
  `defaultValue` to `"2026-08-01"`, which is why `expectedText: "August 2026"`
  has not gone stale.
- The rendering path has no live clock: `new Date()` / `Date.now()` appears
  **twice** in all of `src/ui` (`authority-sync.ts:122`, an injectable default;
  `events-record.ts:273`, a staged-child key that is never rendered).
- Only 5 CSS transitions exist (`styles.css:147,154,196,218,1440`), and
  `toHaveScreenshot` disables animations by default.

Facts that make it a bad trade **now**:

- `src/ui/styles.css:40` sets `--adl-font-family: system-ui, sans-serif`.
  `system-ui` resolves through fontconfig to whatever the host has installed, and
  this repo has **no CI** (there is no `.github/`), so every run is somebody's
  laptop or a worktree on it. A baseline would be a per-machine artefact
  pretending to be a check.
- Churn: of the last 100 commits, **52 touched `src/reference/**`** and **63
  touched `src/ui/**`**. Baselines would demand regeneration on roughly three
  commits in five, and the review of a regenerated baseline is the same human
  eyeball that is supposed to be doing the checking.

### 10. The specs are negative-rich, and at least one negative is vacuous

Measured, because the new rule in `learnings/process/testing-expectations.md`
turns on it:

- **21 `toHaveCount(0)`** assertions (giggle 10, passkey 7, startup 4) and **17**
  other negatives (`not.toContainText`, `not.toEqual`, `not.toBeVisible`). These
  specs are *not* positive-only; the authors were careful.
- Most are anchored by a positive on the same surface. Three checked by hand:
  `passkey-sign-in.spec.ts:137` (`createFirstBand` absent) sits one line after
  `expect(page.locator("adl-app")).toContainText("The Newcomers")`;
  `giggle-band.visual.spec.ts:470-473` asserts the drawer's title and tools
  before asserting anything about absence; `administration.spec.ts:56-57` asserts
  `data-administration-status="unavailable"` before asserting the two absences.
- **One is vacuously satisfiable.** `giggle-band.visual.spec.ts:476`:
  `await expect(page.locator(".adl-topbar-tools")).not.toContainText("Sign out")`
  passes if `.adl-topbar-tools` does not exist at all. The assertion means "the
  sign-out control is declared `PLACEMENT navDrawer`, so it is not in the top
  bar", and it would survive the top bar disappearing entirely. Whether the other
  37 have the same property was not exhaustively checked — **inferred** that most
  do not, on the strength of the three sampled; auditing all 38 is Task 1.
- **The 4 `pageErrors` assertions are the antipattern the rule names directly.**
  They assert the *absence of an exception*, which in this codebase proves
  nothing: ADL degrades silently, a denied read falls back to the raw record id
  rather than raising (`learnings/process/evidence-by-execution.md`). What makes
  those four tests real is the assertion beside them —
  `expect(metadata?.modelVersion).toBe(liveModelVersion)`, a rendered, named
  value read back from the live app. The absence-of-exception line is decoration.

### Dependency

None on unlanded work. This phase touches `tests/visual/**`,
`playwright.config.ts`, one new fast-suite test file, and documentation. It does
not touch `src/index.ts`, `src/ui/components/register.ts`, shell chrome, the
ordered migration SQL, the conformance runner, or any reference-app fixture.

## Decision

### A. One evidence fixture, extending `page` — not `context`

`tests/visual/support/evidence.ts` exports a `test` extending
`@playwright/test`'s with an `evidence` fixture, attaching listeners **before**
the test body runs:

```ts
page.on("console",       msg => record({ kind: "console", level: msg.type(), text: msg.text(), at: msg.location() }));
page.on("pageerror",     err => record({ kind: "pageerror", text: err.message, stack: err.stack }));
page.on("request",       req => record({ kind: "request", method, url, resourceType }));
page.on("response",      res => record({ kind: "response", status, url, fromServiceWorker }));
page.on("requestfailed", req => record({ kind: "requestfailed", url, failure: req.failure()?.errorText }));
page.context().on("page", p => attachTo(p));   // popups and secondary pages
```

**The `context` fixture is deliberately not overridden.** The prior-art project
(`mi-c3/qa-testing`, `apps/hr/steps/fixtures.ts:124-131`) overrides it for a
per-scenario HAR, and its own comment records the price: doing so disables
Playwright's built-in video/trace attachment, forcing the fixture to become the
sole trace controller and to set `use.trace: "off"`. This repository relies on
`trace: "retain-on-failure"` as its only automatic failure artefact. JSONL from
`page` events costs nothing and breaks nothing.

### B. What is asserted, and what is only recorded

At the end of every test — in the fixture teardown, after the body, before the
page closes — the recorder is reviewed. Six gates **fail the test**:

1. any `pageerror`;
2. any console message of type `error`;
3. any `requestfailed`;
4. any response with `status >= 400`;
5. any authority security-log event with `outcome: "failed"`;
6. **the empty-recorder gate**: the page navigated somewhere other than
   `about:blank` and the network stream is nonetheless empty, or a project with
   an authority produced a zero-length slice for a test that made authority
   requests.

Gate 6 is the negative half of the capture itself, and it is the one that is
normally skipped. A recorder that silently stops recording — a listener attached
to the wrong page, a fixture ordering change, a Playwright upgrade renaming an
event — makes all five other gates pass permanently and invisibly. Gate 6 makes
that state fail loudly.

Everything else is **recorded and indexed, never failed**: screenshots, console
`warn`/`info`/`log`/`debug`, the full request/response table, `outcome: "denied"`
authority events, and allowances that matched nothing.

The `warn` exclusion is a decision, not an omission (Evidence §8): warning is the
application's designed announcement of survivable degradation, and every offline
test would need an allowance for warnings it is supposed to produce. Warnings are
counted per test in the index so a jump is visible. `outcome: "denied"` is
excluded for the same reason at the server — a denial is the policy engine
working, and `administration.spec.ts` exists partly to prove denial and absence
stay indistinguishable to the user.

Gate 5 is a genuinely new capability: no test here has ever asserted anything
about what the authority did during a browser test.

### C. Allowances: declared in place, with a required reason, and surfaced

An allowance is a *declaration of intent*, not a silencer. The API makes that
structural:

```ts
interface AllowRule {
  /** Required. Recorded in the evidence beside every entry it permits. */
  reason: string;
  consoleText?: RegExp;
  pageError?: RegExp;
  requestUrl?: RegExp;      // matches requestfailed and >= 400 responses
  status?: number;
  authorityEvent?: RegExp;
}

evidence.allow(rule): void;                                                 // rest of the test
evidence.during<T>(rules: AllowRule[], body: () => Promise<T>): Promise<T>; // scoped
```

`reason` is non-optional in the type, so `npx tsc --noEmit` refuses an
unexplained allowance. Prefer `during(...)`: it scopes the permission to the
window in which the test provokes the failure, so noise before or after still
fails.

```ts
await evidence.during(
  [{ reason: "the network is disabled on purpose; this test exists to prove the shell survives it",
     requestUrl: /.*/ }],
  async () => {
    await context.setOffline(true);
    await page.reload();
    await expectShellReady(page);
    // ... the cache-boundary assertions, all inside the window
  },
);
```

Three properties fall out, all required:

- **Every suppressed entry keeps its reason in the evidence.** `verdict.json` and
  the index report "12 failed requests, all allowed: *the network is disabled on
  purpose…*", never "0 failed requests". A reader sees the count and the
  justification, not a silence.
- **An allowance that matched nothing is reported** in the index's review section
  as `unused allowance`. It means the deliberate failure stopped happening, which
  usually means the test no longer proves what its comment claims. It does not
  fail the test — an offline reload legitimately produces zero failed requests if
  everything was cached — but it is put in front of a human.
- **Counts are available**, so a test that wants to assert the failure really
  occurred writes it explicitly. The gate never asserts it implicitly.

Config-level or project-wide allowances are rejected: an allowance must sit next
to the line that causes the failure, or it rots into a blanket exemption nobody
can attribute.

**The standing rule, to be written into `AGENTS.md`:** an allowance is never how
a genuine console error or failed request is made to go away — the same
prohibition `AGENTS.md` already carries against weakening a constraint to make
verification pass.

### D. The authority log, captured through the injected sink

`tests/visual/support/authority-log.ts`:

```ts
export class RecordingSecurityLogger implements SecurityLogger {
  readonly events: SecurityLogEvent[] = [];
  write(event: SecurityLogEvent): void { this.events.push(redactSecurityData(event) as SecurityLogEvent); }
  mark(): number { return this.events.length; }
  since(mark: number): SecurityLogEvent[] { return this.events.slice(mark); }
}
```

Both harnesses pass one to `createAuthorityHttpHandler` and expose it on the
harness object. Both also record per-request outcomes around their `createServer`
callback, and — critically — **stop swallowing the exception**: the empty
`catch {}` records the error before writing its 500, so a server-side crash
during a browser test is finally visible.

Slicing is by **buffer index, not timestamp**: `mark()` before the body,
`since(mark)` after. `fullyParallel: false`, and each authority lives in the
`beforeAll` of a single spec file whose tests run serially in one worker, so the
slice is exact rather than approximate. Redaction happens at record time, so
nothing unredacted is ever held in memory or written to disk.

### E. Screenshots become attachments; no baselines this phase

Every `page.screenshot(...)` keeps its `path`, moves to `testInfo.outputPath(...)`
where it is not already there (the 9 sites in `passkey-sign-in.spec.ts`), and
additionally becomes an **attachment**, so it appears in `result.attachments`, in
the HTML report and in the index.

`toHaveScreenshot` is **not** adopted, on the measured trade in Evidence §9. The
cheap prerequisite is taken instead — the fixture injects a test-only
`--adl-font-family` override via `addInitScript`, so the day baselines are wanted
the largest flake source is already gone. No production CSS changes.

### F. A first-class negative-assertion surface

This is the half that makes the new project rule cheap instead of a chore, and it
falls out of the evidence layer almost for free: once the network stream and the
authority's verdicts are recorded per test, "this was refused" becomes a fact you
can assert rather than a thing you hope. `tests/visual/support/expect-absence.ts`:

```ts
/**
 * `absent` matches nothing inside `within`, AND `present` matches something
 * inside it. The anchor is REQUIRED, not optional.
 *
 * `expect(x).toHaveCount(0)` is satisfied equally by "the control is correctly
 * not offered", "the page never mounted", and "somebody renamed the selector".
 * This repository already carries at least one assertion a missing container
 * would satisfy (giggle-band.visual.spec.ts:476). Requiring the anchor makes
 * the non-vacuity structural rather than a habit.
 */
export async function expectAbsentWithin(scope: {
  within: Locator; absent: Locator; present: Locator; because: string;
}): Promise<void>;

/**
 * A request matching `url` was recorded, and was answered `status`.
 *
 * Distinguishes the two failure modes a bare toHaveCount(0) conflates:
 *  - no matching request was recorded at all -> "the affordance never fired;
 *    use expectNoRequestTo if that is what you meant";
 *  - a matching request was answered 2xx -> "the thing you expected to be
 *    refused was permitted", which is the defect.
 *
 * Doubles as the gate-4 allowance: a refusal you assert is a refusal you
 * expected, so it is not also reported as an unexplained 4xx.
 */
export async function expectRequestRefused(evidence: Evidence, expected: {
  method?: string; url: RegExp; status: number; reason: string;
}): Promise<void>;

/** No request matching `url` was made at all. Fails, with the recorded entry,
 *  if one was — the affordance fired when it should not have existed. */
export async function expectNoRequestTo(evidence: Evidence, url: RegExp): Promise<void>;

/**
 * The AUTHORITY recorded a denial for this endpoint during this test.
 *
 * The deeper half of the Phase 99 defect: a button hidden by the UI is not the
 * same fact as an action the server refuses, and the UI-side assertion could
 * never have caught a button whose click the server would have refused.
 * Pair expectAbsentWithin (it is not offered) with expectAuthorityDenied
 * (and it would be refused if it were).
 */
export async function expectAuthorityDenied(evidence: Evidence, expected: {
  event: RegExp; endpoint?: RegExp; reason?: RegExp;
}): Promise<void>;
```

`because` and `reason` are required strings on every one of them, and they are
what the failure message and the evidence file say. A negative assertion that
cannot explain itself is not accepted.

**The documented pattern that goes with them.** To prove a hidden affordance is
also refused server-side, drive the endpoint the hidden button would have hit
with `page.request.post(...)` — which shares the page context's cookie jar, so it
is the *same* principal, not a fresh anonymous one (**inferred** from the
Playwright API; confirmed in Task 3) — then assert `expectRequestRefused(…, {
status: 403 })` and `expectAuthorityDenied(…)`. That is the negative half of
"a signed-in band admin can create a band" and it is currently unwritable.

**And the rule the helpers exist to enforce, stated plainly for `AGENTS.md`:**
*assert on rendered values and named identities, never on the absence of an
exception.* ADL degrades silently — a denied read falls back to the raw record id
rather than raising — so "no error was thrown" proves nothing, and the six gates
in Decision B must never be mistaken for proof that a screen works. They prove
the screen did not *break*. Something must still assert what it *said*.

### G. Layout and lifecycle

The evidence folder **is** Playwright's own per-test output directory. Nothing is
relocated.

```
test-results/visual/                       (gitignored, cleared at the start of each run)
  EVIDENCE.md                              run index — the human entry point
  evidence-index.json                      the same, machine-readable
  servers/vite-5173.log …                  best-effort web-server output (see below)
  <spec>-<title>-<project>/                Playwright's own per-test directory
    console.jsonl                          every console message, all levels, plus page errors
    network.jsonl                          every request, response and failure
    authority.jsonl                        the security-log slice (passkey / administration only)
    verdict.json                           counts, gates, allowances used and unused
    *.png                                  screenshots, also attached
    trace.zip                              existing behaviour, on failure
```

`tests/visual/support/evidence-reporter.ts` writes `EVIDENCE.md` at `onEnd` from
`result.attachments`. It opens with a **Review** section — tests with unused
allowances, non-zero warning counts, or large allowed-failure counts — then a
table of all rows: project, title, status, screenshots, console errors (allowed /
unallowed), warnings, failed requests, non-2xx, authority `failed` events, and a
relative link. One stdout line: `Evidence: test-results/visual/EVIDENCE.md — 59
tests, 3 need review`.

**Not adopted: a timestamped accumulating run folder.** The prior-art reporter
gives each run its own `test-run-YYYY-MM-DD-HHMMSS/` tree because there the
artefacts are a QA deliverable handed to somebody else. Here they are a developer
feedback loop consumed minutes after the run, and relocating files out of
`testInfo.outputDir` breaks the HTML report's links to its own attachments and
traces.

**Web-server logs are run-level and best-effort.** Playwright's `webServer` has
no file hook, so each `command` gains a shell redirect into
`test-results/visual/servers/`. Two limitations get *recorded in the index*
rather than hidden: with `reuseExistingServer: true` an adopted server produces
no log at all, and a `globalSetup` probe records, per port, whether it was
already listening when the run began. That is also a direct guard against the
failure mode `learnings/process/visual-browser-verification.md` already
documents — a stale Vite from another checkout silently reused, so a screenshot
appears to verify something it never touched.

### What is taken from `mi-c3/qa-testing`, and what is not

**Taken, adapted:**

- *Fixture-records, reporter-writes.* The one-way split from
  `apps/hr/steps/fixtures.ts` and `framework/pw/bdd-artifact-reporter.ts`: the
  fixture only calls `testInfo.attach`, exactly one component writes files. It is
  race-free under parallel workers and it is why the index can be built at all.
  Adapted: we attach into `testInfo.outputDir` rather than relocating.
- *Console capture shape.* `fixtures.ts:154-155` — `p.on("console", …)` plus
  `p.on("pageerror", …)` into one ordered buffer attached as one artefact. Taken
  almost verbatim; upgraded from `[type] text` lines to JSONL with source
  location, because ours is asserted on and theirs is only read.
- *Structural secret redaction before recording.* `api-evidence.ts:36-48`. We do
  not port the code — this repository already has a better version in
  `redactSecurityData`, which is the authority's own redactor. The principle
  transfers: redact at record time, never at render time.
- *A failure index at the top of the run.* `bdd-artifact-reporter.ts:writeFailedSummary`
  writes `FAILED.md`, one row per failure, linking to its evidence folder. The
  single most valuable idea in the prior art, and the direct answer to "it gets
  reviewed at the end of the test". **Broadened**: theirs lists only failures;
  ours lists every test and puts a *review* section on top, because a passing
  test with 40 unexplained warnings is exactly what this phase exists to surface.
- *Expectation-aware verdicts, and the permanent self-check they enable.*
  `bdd-artifact-reporter.ts` counts a `@fail` scenario that fails as `expected`
  and flags one that unexpectedly **passes**. Two things here descend from it:
  the "unused allowance" signal, and — more importantly —
  `tests/visual/evidence-self-check.spec.ts` (Decision H).

**Deliberately not taken:**

- *HAR recording.* Requires `recordHar` on the context, which requires overriding
  the `context` fixture, which their own comment records as breaking built-in
  trace on retry and forcing `use.trace: "off"`. `har-prune.ts` exists to shrink
  an artefact we will not produce.
- *Video recording.* 59 videos per run is cost with no reader; the trace already
  carries per-action screenshots on failure.
- *The PDF report.* A second headless Chromium rendering per-scenario PDFs, for
  evidence handed to people outside the repository. Ours is read in a terminal by
  the person who just ran it.
- *Per-step screenshots* (`step-capture.ts`, a Gherkin `AfterStep` hook). There
  is no BDD layer here and no step boundary to hook; our specs choose their
  screenshot moments deliberately and those choices are the evidence.
- *`api-evidence.ts`'s `installFetchRecorder`*, which monkeypatches
  `globalThis.fetch`. Our equivalent problem is solved better and without
  monkeypatching, because the server is in-process and already accepts an
  injected `SecurityLogger` (Evidence §4).
- *`testid-audit.ts`, `settle.ts`, and most of `testing-hardening.md`.* That
  rulebook is explicit that it governs "integration-in-the-large against a shared
  UAT environment … there is no mocking … you do not control the network or
  backend timing". This suite is the opposite: it owns its servers, seeds
  deterministic data, and deliberately uses `context.route` and `setOffline` to
  force error paths — which §4 of that document forbids outright. Importing it
  wholesale would outlaw four of our seven spec files.

### H. The gates prove they can fail, permanently

A gate that has never been seen red is not a gate, and a gate proven red once by
a probe that was then deleted is a gate whose failure mode is unprotected from
the next refactor. `tests/visual/evidence-self-check.spec.ts` — a new spec on the
existing dev server, in the `desktop` project — makes each gate's *ability to
fail* a permanent, self-verifying test.

For each of the six gates, a pair:

- a `test.fail()` case that provokes the signal **unallowed**, which Playwright
  therefore requires to fail — and which reports an **unexpected pass** as a
  suite failure if somebody deletes or weakens the gate;
- an ordinary case that provokes the same signal **with an allowance**, asserting
  it passes *and* that `verdict.json` records the entry with its reason.

The provocations are cheap and local: `page.evaluate(() => console.error(…))`,
`page.evaluate(() => { throw … })`, `route.abort()` on a request the page makes,
a `page.request.get()` against a path the dev server 404s, and — for gates 5 and
6 — a synthetic recorder driven directly.

**Inferred, and confirmed in Task 3:** that `test.fail()` covers a failure raised
in *fixture teardown* rather than in the test body. If it does not, the fallback
is stated rather than left to be discovered: the classifier's fail verdict is
proven in the hermetic unit suite (where most of it belongs anyway), and the
end-to-end "a fail verdict really turns a Playwright test red" fact is proven
once by Task 3 and recorded in the execution note.

## Scope

- `tests/visual/support/evidence.ts` — **new.** Extended `test`, the `evidence`
  fixture, `AllowRule`, allowance matching, the six gates, JSONL writers, the
  screenshot-attach helper, the test-only font override.
- `tests/visual/support/expect-absence.ts` — **new.** `expectAbsentWithin`,
  `expectRequestRefused`, `expectNoRequestTo`, `expectAuthorityDenied`.
- `tests/visual/support/authority-log.ts` — **new.** `RecordingSecurityLogger`
  and the request-record wrapper.
- `tests/visual/support/evidence-reporter.ts` — **new.** `EVIDENCE.md` and
  `evidence-index.json`.
- `tests/visual/support/evidence-globals.ts` — **new.** The `globalSetup` port
  probe.
- `tests/visual/evidence-self-check.spec.ts` — **new.** Decision H's twelve
  paired cases.
- `tests/visual-evidence.test.ts` — **new**, in the **fast hermetic suite**. Unit
  coverage of every pure part, positive and negative.
- All 7 files in `tests/visual/*.spec.ts` — import `test` from
  `./support/evidence.js`; add allowances at the sites in Evidence §7; keep every
  existing assertion.
- **The negative-assertion audit, which goes in first (Task 1).** All 38 existing
  negative assertions are checked for a present-anchor. Each unanchored one is
  rewritten through `expectAbsentWithin`, starting with the measured case at
  `giggle-band.visual.spec.ts:476`. This is scope, not a follow-up:
  `learnings/process/phase-execution.md` puts missing negative coverage in the
  phase that arrives at it.
- `tests/visual/passkey-sign-in.spec.ts` — additionally, 9 hard-coded screenshot
  paths move to `testInfo.outputPath`, and 4 test signatures gain `testInfo`.
- `tests/visual/passkey-authority.ts`, `administration-authority.ts` — pass a
  `RecordingSecurityLogger`, expose it, record per-request outcomes, stop
  discarding the exception in the empty `catch`.
- `playwright.config.ts` — register the reporter, the `globalSetup`, the
  `webServer` log redirects, and the self-check spec's `testMatch`.
- `AGENTS.md`, `CLAUDE.md`,
  `learnings/process/visual-browser-verification.md`,
  `learnings/process/testing-expectations.md` — see Documentation.

## Non-goals

- **No `toHaveScreenshot`, no committed baselines.** Decided in E on measured
  grounds; named for a follow-up phase.
- **No change to any production source file.** `src/**` is untouched; the
  authority's logger injection point already exists.
- **No deletion of any existing assertion.** The 4 narrow `pageErrors`
  assertions stay exactly as they are, reading `evidence.pageErrors` instead of a
  local array. The new gate is strictly stronger and subsumes them, but deleting
  a specific documented assertion because a general one now covers it is the
  quiet weakening this repository forbids. Evidence §10 records that they prove
  little; the fix is the assertion *beside* them, which already exists.
- **No CI.** There is none, and adding one is a separate subject.
- **No video, no HAR, no PDF, no per-step capture.** Justified above.
- **No new npm dependency.** `@playwright/test` plus `node:fs`.
- **No per-test slicing of the Vite web-server logs.** Run-level, best-effort,
  with the reuse caveat stated in the index.

## Constraints

- **The port lock is a first-class constraint.** `playwright.config.ts` binds
  5173/4173/5273/5373 with `reuseExistingServer: true`. Before trusting any run,
  confirm ownership of each port (`ss -ltnp`, then `/proc/<pid>/cwd`) — a server
  started by another agent or checkout, possibly built with a different
  `VITE_ADL_AUTHORITY_URL`, is adopted silently. Already recorded in
  `learnings/process/visual-browser-verification.md`.
- **A pipeline masks the exit code.** Redirect to a file, capture `$?` on the
  very next line, print it, read the number.
- **Assert on rendered values and named identities, never on the absence of an
  exception.** The six gates prove a screen did not break; they never prove it
  worked. Every gate added here must be paired in the specs with an assertion on
  something the app actually rendered or the server actually recorded.
- **Every negative assertion carries its anchor.** `toHaveCount(0)` without a
  co-asserted present element is not accepted in new or rewritten code.
- **No allowance without a reason**, enforced by the type; no allowance added to
  make a genuine finding go away.
- **The negative cases go in first and are seen to fail** before the code that
  makes them pass exists.
- **`npm test` stays hermetic and Playwright-free.** The new unit file tests pure
  functions only.

## Acceptance Criteria

Named assertions, in pairs. The positive half proves the thing happens; the
negative half proves it does not happen when it should not, and — for a capture
pipeline, where this matters most — that silence is not mistaken for success.

### Capture

| # | Positive | Negative |
|---|---|---|
| 1 | `expectConsoleStreamRecordsEveryLevel` — a test emitting one message at each of `log`/`info`/`warn`/`error` leaves four entries in `console.jsonl`, each with its level and source location. | `expectEmptyConsoleStreamIsNotSilentSuccess` — a fixture whose console listener is not attached leaves `console.jsonl` present and explicitly zero-length, and gate 6 fails the test when the page nevertheless navigated. |
| 2 | `expectNetworkStreamRecordsRequestsAndResponses` — a page load leaves matched request/response entries with method, url and status. | `expectRecorderWiringFailureIsFatal` — with the network listener deliberately detached, a test that navigates **fails** on gate 6 rather than reporting a clean zero. |
| 3 | `expectAuthoritySliceIsExactlyThisTest` — in the `passkey` project, test *n*'s `authority.jsonl` holds precisely the events between its `mark()` and `since()`. | `expectNoAuthorityEventAppearsInTwoTests` — the union of the per-test slices across the file equals the whole buffer, and the intersection of any two slices is empty. |
| 4 | `expectEveryScreenshotIsAttached` — all 31 appear in `result.attachments` and under `testInfo.outputDir`. | `expectNoScreenshotAtOutputDirRoot` — no `*.png` is written to the root of `test-results/visual/`, which is what the 9 passkey sites do today. |

### The gates

| # | Positive (the gate fires) | Negative (the gate stays quiet) |
|---|---|---|
| 5 | `expectUnallowedConsoleErrorFailsTest` — an injected `console.error` fails an otherwise-green test, naming the text and the spec. | `expectAllowedConsoleErrorPassesAndRecordsItsReason` — the same error inside `during([{reason: …, consoleText: …}])` passes, and `verdict.json` shows one *allowed* console error carrying that reason string. |
| 6 | `expectUnallowedPageErrorFailsTest` — an injected uncaught `throw` fails the test. | `expectAllowedPageErrorPasses` — `startup-failure-recovery`'s deliberate `indexedDB.open` throw passes, with its reason recorded. |
| 7 | `expectUnallowedRequestFailureFailsTest` — an injected `route.abort()` fails the test. | `expectAllowedRequestFailurePasses` — `offline-shell`'s `setOffline(true)` window passes, and the index reports the count as allowed, not as zero. |
| 8 | `expectUnallowedNon2xxFailsTest` — a request answered 404 fails the test. | `expectAssertedRefusalDoesNotAlsoFailTheTest` — a 403 asserted through `expectRequestRefused` is *not* also reported as an unexplained 4xx. |
| 9 | `expectAuthorityFailedOutcomeFailsTest` — a forced throw in the harness handler produces `outcome: "failed"` **with the error message** and fails the test through gate 5. | `expectAuthorityDeniedOutcomeDoesNotFailTest` — `administration.spec.ts`'s deliberate denial path produces `outcome: "denied"` records and the test passes. Denial is the policy engine working. |
| 10 | `expectWarningIsCountedInTheIndex` — the warning count for a test that warns is non-zero in `EVIDENCE.md`. | `expectWarningDoesNotFailTest` — the same test passes. Evidence §8. |
| 11 | `expectEachGateCanBeSeenRed` — Decision H's six `test.fail()` cases all fail, permanently. | `expectDeletingAGateTurnsItsSelfCheckRed` — the mutation check: removing gate *n* makes case *n* an **unexpected pass**, and each removal breaks a *distinct, non-overlapping* set of assertions. Phase 102's standard. |

### The negative-assertion surface

| # | Positive | Negative |
|---|---|---|
| 12 | `expectAbsentWithinPassesWhenAnchorPresentAndTargetAbsent`. | `expectAbsentWithinFailsWhenAnchorMissing` — a blank page cannot satisfy an absence assertion. This is the whole point of the helper. |
| 13 | `expectRequestRefusedMatchesRecordedStatus` — a 403 the test provoked is asserted by url and status. | `expectRequestRefusedFailsWhenRequestSucceeded` — if the endpoint answers 2xx, the assertion fails naming the status it got; and `expectRequestRefusedFailsWhenNoRequestWasMade` — a refusal you never attempted is not a refusal. Two distinct failures, not one. |
| 14 | `expectNoRequestToPassesWhenAffordanceAbsent`. | `expectNoRequestToFailsWhenRequestWasMade`, naming the recorded entry. |
| 15 | `expectAuthorityDeniedRecordsTheServerSideRefusal` — driving a hidden affordance's endpoint with `page.request` produces both a non-2xx and an `outcome: "denied"` record. | `expectAuthorityDeniedFailsWhenServerAllowed` — the Phase 99 shape: the UI hides the control **and the server permits the call**, which must fail. This is the assertion nobody could write before this phase. |

### The existing specs

| # | Positive | Negative |
|---|---|---|
| 16 | `expectTopBarToolsRendered` — the anchor for the assertion at `giggle-band.visual.spec.ts:476`. | `expectSignOutAbsentFromTopBar` — rewritten through `expectAbsentWithin`, **seen failing first** against a deliberately-removed anchor, so the vacuity measured in Evidence §10 cannot return. |
| 17 | `expectEveryTestHasAnIndexRow` — `EVIDENCE.md` has 59 + 12 data rows and every link resolves. | `expectUnusedAllowanceAppearsInReview` — a deliberately unused allowance is listed under Review and does **not** fail its test; and `expectCleanRunHasEmptyReviewSection` — a run with nothing to review says so, rather than always listing something. |

### Whole-run

18. `npm run test:visual` green with all gates on, and **no existing assertion
    deleted or weakened**. Any genuine defect found is fixed, or recorded in the
    execution note and the Planning Handoff as a named follow-up — never allowed
    away.
19. `npx tsc --noEmit`, `npm run format:check` and `npx vitest run` clean, fast
    suite at baseline plus `tests/visual-evidence.test.ts`.
20. `npm run verify:push` run exactly once, at the end, exit code captured on the
    next line and read.

**Disclosure required by `testing-expectations.md`.** Two criteria have no
meaningful negative half and this is stated rather than manufactured: criterion
19 (a typecheck either passes or does not) and the `EVIDENCE.md` Markdown
renderer's formatting, whose negative half is covered structurally by 17 rather
than by a hollow "it does not render a row for a test that does not exist".

## Testing

- **Fast hermetic** (`npx vitest run`). `tests/visual-evidence.test.ts` covers,
  in pairs: an `AllowRule` matching **and not matching** each of the five entry
  kinds; a `during(...)` window including an entry inside it **and excluding**
  one recorded outside; gate classification putting `warn` and `denied` on the
  record-only side **and** `error`/`pageerror`/`requestfailed`/`>=400`/`failed`
  on the fail side; `mark()`/`since()` slicing over empty, single and
  multi-event buffers **and** disjointness of two consecutive slices; the Review
  selector choosing a noisy run **and** producing an empty section for a clean
  one. These are the parts that must be right before a Playwright run is worth
  its cost, and they are why gate logic is a pure function over a recorded
  buffer rather than inline in the fixture.
- **Playwright** (`npm run test:visual`, once, at the barrier, ports confirmed).
  Criteria 1-18.
- **Every negative case goes in first and is seen failing** before the code that
  satisfies it exists. The exact failure text of criteria 5, 6, 7, 8, 9, 12, 13
  and 16 goes in the execution note. A negative assertion written after the fix
  is the easiest kind to write vacuously.
- **Mutation check** (criterion 11's negative half). Remove each gate in turn;
  each removal must break a *different* named self-check case and no other. A
  gate no test can distinguish from its absence is not a gate.
- **Not run:** `npm run test:integration`. Nothing here touches the authority's
  production path, PostgreSQL, migrations, the unit-of-work or the HTTP edge —
  only the two in-process test harnesses that instantiate the handler.

## Parallel Execution Plan

The serial spine is unusually load-bearing: six work streams consume the same
`AllowRule` / `EvidenceEntry` types and the same fixture signature. Fan out only
after they are real, or later agents predict them.

1. **Serial spine — one pass, no consumers.** `tests/visual/support/evidence.ts`
   (types, fixture signature, `AllowRule`, `allow`/`during`, the six gates as a
   pure classifier, the JSONL writer), `expect-absence.ts`'s four signatures, and
   `authority-log.ts`'s `RecordingSecurityLogger`. No spec touched. `npx tsc
   --noEmit` clean at the end of this step.
2. **Task 1 — the negative-assertion audit, before anything else changes.** All
   38 existing negatives checked for an anchor; the unanchored ones rewritten
   through `expectAbsentWithin` and seen failing against a removed anchor first.
   Serial: it edits the same spec files everything else will.
3. **Task 0 — the inventory run, before any allowance is written.** Gates in
   **report-only** mode, full suite once, writing down every console error,
   failed request, non-2xx and authority `failed` event observed, per test. This
   is the measurement Evidence §7 marks inferred. Allowances are then written
   against what was observed, not what was predicted; anything observed that is
   not a deliberate provocation is a finding under criterion 18. Serial — it
   needs the ports.
4. **Fan out (disjoint files; no shared file, so no worktree isolation needed):**
   - **A:** `evidence-reporter.ts` + `evidence-globals.ts` + the
     `playwright.config.ts` registration.
   - **B:** the two authority harnesses' recorders and un-swallowed `catch`.
   - **C:** spec migration group 1 — `giggle-band`, `jointly-care`,
     `browser-demo`.
   - **D:** spec migration group 2 — `startup-failure-recovery`, `offline-shell`
     (allowances from step 3's inventory).
   - **E:** spec migration group 3 — `passkey-sign-in` (allowances **plus** the 9
     screenshot-path moves), `administration`.
   - **F:** `tests/visual-evidence.test.ts` — the hermetic pairs.
   - **G:** `tests/visual/evidence-self-check.spec.ts` — Decision H's twelve
     cases.
   - **H:** documentation — `AGENTS.md`, `CLAUDE.md`, the two learnings files.
5. **Barrier.** `npx tsc --noEmit`, `npm run format:check`, `npx vitest run`.
6. **Second serial run.** Gates on, full `npm run test:visual`, once, ports
   confirmed. Then the mutation check. Triage anything red under criterion 18.
7. **`npm run verify:push` exactly once, at the end**, exit code captured on the
   next line and read. Inspect the screenshots `EVIDENCE.md` points at.

`playwright.config.ts` is the one file two streams could contend for; it is
assigned to stream A alone. `src/index.ts`, `src/ui/components/register.ts`,
shell chrome, migration SQL, the conformance runner and reference-app fixtures
are all untouched.

## Tasks

1. Confirm port ownership (`ss -ltnp` → `/proc/<pid>/cwd`) for all four ports.
2. Build the serial spine; `tsc` clean.
3. Verify the four inferred mechanics before anything depends on them, and record
   each result: (a) a throw in a fixture teardown after `use()` fails the test and
   is attributed to it; (b) `testInfo.attach` works from that teardown;
   (c) `test.fail()` covers a teardown-raised failure — if not, apply Decision H's
   stated fallback; (d) `page.request` shares the page context's cookie jar.
4. Audit and repair the 38 existing negative assertions (Parallel step 2),
   negatives seen failing first.
5. Run the report-only inventory (Parallel step 3); write the observed inventory
   into the execution note.
6. Write the paired hermetic tests and the self-check spec **before** the
   corresponding gate implementations are finished; observe each negative case
   red; record the exact messages.
7. Fan out streams A-H.
8. Barrier checks; the full gated visual run; the mutation check; triage.
9. Update `AGENTS.md`, `CLAUDE.md` and the two learnings documents.
10. `npm run verify:push` once; read the exit code; inspect the screenshots the
    index points at; commit; push.

## Documentation

- **`AGENTS.md`, Testing.** "Inspect the generated screenshots before committing"
  becomes "read `test-results/visual/EVIDENCE.md`, then inspect the screenshots
  and evidence it points at." A new subsection, *Browser evidence and deliberate
  failures*, states the six gates, the record-only streams, the rule that an
  allowance requires a written reason and is never a way to make a genuine
  finding go away, and — beside it — *assert on rendered values and named
  identities, never on the absence of an exception*, with the note that the gates
  prove a screen did not break and never that it worked.
- **`CLAUDE.md`, Testing.** The same one-line redirection.
- **`learnings/process/visual-browser-verification.md`.** A new *Evidence*
  section: the folder layout, the fixture, the six gates and why `warn` and
  `denied` are not among them, the allowance discipline and the unused-allowance
  signal, the negative-assertion helpers and the anchor rule, and — the fact most
  likely to be re-derived the hard way — that the `passkey` and `administration`
  authorities are **in-process in the Playwright worker**, so their log is
  captured by injecting a `SecurityLogger`, not by tailing a file. Plus the
  measured reasoning against `toHaveScreenshot` (`system-ui`, no CI, 52/100 and
  63/100 commit churn), so the next person to propose it starts from the numbers.
- **`learnings/process/testing-expectations.md`.** Under the new negative-test
  rule's "Browser specs" bullet: name the helpers, and record that
  `toHaveCount(0)` without a present-anchor is the browser form of the vacuous
  negative the rule warns about — with the measured example.
- **`learnings/index.md` is NOT edited by this phase** — another agent held it
  during planning, and it has since changed on `main`. The line it needs is
  recorded in the Planning Handoff for whoever lands next.

## Planning Handoff

**Next phase: Phase 108 — whatever Task 0's inventory and Task 4's audit turn
up.** Not a placeholder. Evidence §7 predicts, and marks inferred, that four of
seven spec files provoke failures on purpose; it cannot predict what the other
three produce, and this repository has never looked. A `console.error` in
`giggle-band` or `jointly-care` under the desktop or mobile projects would be a
real defect invisible since the suite was written, and criterion 18 forbids
allowing it away. Likewise, Evidence §10 measured one vacuous negative out of a
sample of four; if the full audit finds a dozen, repairing them is a phase.
One-file fixes fold into 107; anything larger is Phase 108, scoped from the
recorded inventory rather than from a guess.

Why this ranks above the alternatives, repository-wide:

- It is the only candidate that changes what the repository can *know*. Every
  other open item is a feature or a fix that would itself be verified by this
  suite, and today that suite's verdict on "did the page work" is "a human looked
  at a PNG". `learnings/process/evidence-by-execution.md` records four incidents
  of confident, wrong claims about runtime behaviour, two caught only by looking
  at a rendered screen. Strengthening what a run can tell you compounds across
  everything after it.
- It is the enabling half of the rule `main` adopted at `50701a9`. That rule now
  requires a negative case beside every positive one, and for browser specs the
  negative half is precisely what is hardest to write here: an affordance that
  must be absent without the assertion being satisfiable by a blank page, a
  request that must be refused, a denial that must have actually reached the
  server. Decision F makes all three one-liners. Adopting the rule without this
  produces more `toHaveCount(0)`, which is the vacuous form the rule warns about.
- It is cheap relative to that: no production code, no new dependency, no model
  or migration hop, no `modelVersion` move, therefore no persisted-state upgrade
  obligation.
- It is the last cheap moment. The gates must be introduced against a suite whose
  deliberate failures are enumerable by hand — 7 files, 6 known provocations.
  Every spec added before it makes the first green run more expensive.

Three candidates surfaced and were deliberately not taken:

- **Baseline screenshot comparison** (`toHaveScreenshot`). Wants a pinned web
  font instead of `system-ui` — which this phase already arranges as a test-only
  override — and somewhere reproducible to run: a CI, or a container image the
  project agrees to compare inside. Without one, a baseline is a per-machine
  artefact pretending to be a check.
- **The same evidence treatment for `tests/integration/**`.** Real PostgreSQL,
  real HTTP edge, the same `SecurityLogger` seam; the per-test authority-log
  slice would transfer almost unchanged, and integration failures there are today
  diagnosed by temporarily instrumenting throw sites
  (`learnings/process/testing-expectations.md` records exactly that). Real value,
  different runner, separate phase.
- **A `metrics` assertion.** `AuthorityMetrics` is injectable at the same seam and
  already counts requests, rejections and rate-limited calls per endpoint.
  Asserting that a browser flow produced the expected *shape* of authority
  traffic is a new class of test. A second subject; naming it here is enough.

**For `learnings/index.md`, once it is free:** add a mapping line — *"Before any
task that adds or changes a Playwright spec, a browser evidence assertion, or a
deliberate-failure allowance, read `process/visual-browser-verification.md`,
`process/testing-expectations.md` and `process/evidence-by-execution.md`."*
