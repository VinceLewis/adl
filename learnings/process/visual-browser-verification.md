# Visual Browser Verification

Read this before changing browser UI rendering, CSS, shell chrome, reference app
screens, or browser verification.

## Decisions

- Browser UI changes need real browser screenshots, not only DOM/unit tests.
  Happy DOM can prove behavior, but it will not catch spacing, clipping,
  wrapping, or viewport-specific composition issues.
- `npm run test:visual` is the Playwright visual smoke suite. It starts or reuses
  the Vite dev server, opens the Giggle Band app, visits every shell navigation
  page, and captures desktop and mobile screenshots. It also captures important
  interaction surfaces such as Event create and edit forms.
- `npm run verify:push` is the pre-push command for UI-affecting changes. It
  runs typecheck, format check, Vitest, build, and the Playwright visual suite.
- Playwright screenshots are generated under `test-results/visual/` and are not
  committed. Inspect the current run's desktop and mobile screenshots before
  pushing UI changes.

## Practical Guidance

- Add or update Playwright checks when a visual regression is found. For example,
  the Giggle home feed now asserts that the time/title separator reserves visible
  width, because text-content assertions alone missed collapsed whitespace.
- Keep visual smoke assertions focused on layout health: expected page content,
  no document-level horizontal overflow, no visible element overflow, and
  specific regression checks for defects found during screenshot review.
- Dense components may intentionally use ellipsis inside constrained cells. Treat
  hidden/ellipsis overflow differently from visible overflow that expands or
  breaks the page.
- When adding a new Giggle page or shell nav item, add it to
  `tests/visual/giggle-band.visual.spec.ts` so desktop and mobile screenshots
  continue to cover every page.
- When changing list or form interaction patterns, add screenshots and layout
  assertions for both the resting page and the opened create/edit surface.
- For shell scrolling changes, assert behavior in the browser instead of
  relying only on screenshots: document scroll should remain at zero, the ADL
  scroll region should be the scrolling element, app chrome should remain
  visible, and list/table sticky controls should be checked in both desktop and
  mobile projects.

## Never Let a Test Navigate Where the App Already Navigates

A Playwright test that calls `page.goto` after an action the *app* responds to
by navigating is racing its own subject, and it loses non-deterministically.
`tests/visual/startup-failure-recovery.visual.spec.ts` clicked
`[data-startup-error-reset]` — whose handler deletes three IndexedDB databases
and then calls `location.reload()` — and immediately called `page.goto` for the
same URL. Measured before the fix: **12 failures in 50 repeats, twice in a
row**, in three signatures that are all one race:

- `page.goto: net::ERR_ABORTED at <url>` (the reload aborted the test's
  navigation),
- `page.goto: Navigation to "<url>" is interrupted by another navigation to
  "<url>"` (the same collision, caught a beat later),
- a `locator.waitFor` timeout on content the test *did* reach, because the app's
  reload then tore that document down underneath it.

The fix is not a sleep, a longer timeout, or a retry — those hide the race and
the third signature defeats them anyway. **Delete the redundant navigation and
wait on a condition only the post-navigation document can satisfy.** Playwright
locator waits are navigation-resilient, so `locator("adl-app").waitFor({ state:
"attached" })` settles on whichever document finally mounts the app. Choose the
condition so it cannot be satisfied by the pre-navigation document: here the
failure document has no `<adl-app>` at all and does have `<adl-startup-error>`,
which the test already asserts. After the change the race did not recur in
**150 repeats** (50 / 49 / 50); the single failure was a different assertion
earlier in the test, in the one batch that was accidentally run while a full
`vitest run` saturated the machine.

This also fixes what the test *proves*. The redundant `goto` asserted that a
fresh visit to the URL recovers, which would pass even if the app's own reload
never happened; waiting on the reload asserts the thing the reset button
actually claims to do.

Two process points that generalise:

- **One isolated run is not a reproduction.** This spec passed on a single
  invocation both before and after the fix. Establish a rate with
  `--repeat-each=N` before believing either a failure or a fix.
- **A warm port is not necessarily *your* port.** `playwright.config.ts` sets
  `reuseExistingServer: true` on every web server, and the dev server binds
  `0.0.0.0` by default. A stale Vite process rooted in a different checkout will
  be silently reused, and a CSS change in a worktree will appear to have no
  effect — or worse, appear verified when nothing was tested. Confirm the owner
  of the port (`ss -ltnp`, then `/proc/<pid>/cwd`) before trusting a screenshot
  taken from a worktree.

## Per-Test Evidence, And What Is Checked Automatically

Phase 107. Every Playwright test now leaves a folder — Playwright's own
`testInfo.outputDir` under `test-results/visual/` — containing:

| File | What is in it |
|---|---|
| `console.jsonl` | every console message at every level, plus uncaught page errors, with source locations |
| `network.jsonl` | every request, response and failure |
| `authority.jsonl` | the authority's own security log for exactly this test (`passkey` and `administration` only) |
| `verdict.json` | the gate review: failures, allowed entries with their reasons, unused allowances, counts |
| `*.png` | the screenshots the spec took, also attached so the HTML report links them |

The run ends by writing `test-results/visual/EVIDENCE.md`, which opens with a
**Review** section and then lists every test. That page is the entry point;
`test-results/` is gitignored, as it was before.

### The six gates

Five fail on an observation, one fails on the absence of observations:

1. any uncaught page error;
2. any console message of type `error`;
3. any failed request;
4. any response with status ≥ 400;
5. any authority security-log event with `outcome: "failed"`;
6. **empty recorder** — the page navigated somewhere real and the network stream
   is nonetheless empty, or authority requests were made and no authority events
   were recorded.

Gate 6 is the one that is normally skipped and the one most worth having. A
recorder that silently stops recording — a listener attached to the wrong page, a
fixture ordering change, a Playwright event rename — makes all five other gates
pass forever and invisibly. It is the negative half of the capture itself.

### What is deliberately *not* gated, and why

- **`console.warn`.** Measured: there is no `console.error` anywhere in `src/`,
  and the seven `console.warn` sites (`session-startup.ts`, `authority-sync.ts`)
  are the application announcing *survivable degradation* — "authority sync is
  unavailable; continuing with local data". Gating on `warn` would gate on the
  design, and every offline test would need an allowance for warnings it is
  supposed to produce. Warnings are counted instead, and an **undeclared** one is
  listed for review.
- **`outcome: "denied"`.** A denial is the policy engine working.
  `administration.spec.ts` exists partly to prove denial and absence stay
  indistinguishable to the user, so a gate on denial would fight its subject.

### Allowances are annotations, not silencers

`AllowRule.reason` is non-optional, so `tsc` refuses an unexplained allowance,
and a rule with no matcher is rejected at construction. Prefer
`evidence.during([...], async () => { ... })` over `evidence.allow(...)`: it
scopes the permission to the window in which the test provokes the failure, so
noise before or after still fails. The reason is written into `verdict.json` and
the index beside every entry it permits, so a reader sees "12 failed requests,
all allowed: *the network is disabled on purpose*" rather than a silence.

An allowance that matched nothing is reported in the Review section. It usually
means the deliberate failure stopped happening, so the test no longer proves what
its comment claims. It does not fail the test.

**An allowance is never how a genuine finding is made to go away.** That is the
existing "never weaken a test to make verification pass" rule, in this costume.

### The authority is in-process, so its log is injected, not tailed

The most likely thing to be re-derived the hard way: the `passkey` and
`administration` projects do **not** spawn an authority process. Both harnesses
`createServer` from `node:http` inside the Playwright worker. There is no stdout
to tail and no log file to slice.

`createAuthorityHttpHandler` accepts `logger?: SecurityLogger`
(`src/server/authority-http.ts`). Passing a `RecordingSecurityLogger`
(`tests/visual/support/authority-log.ts`) gives an exact per-test slice, taken by
buffer index rather than timestamp, already redacted by the authority's own
`redactSecurityData`. Both harnesses also stopped swallowing handler exceptions:
the empty `catch {}` used to turn a real crash into an opaque 500 with the stack
trace destroyed.

The slice is materialised **on demand**, not at teardown, so a test body can
assert on what the server recorded while it is still running. Materialising only
at teardown made every such assertion see an empty list, which is how it was
found.

### The negative half of a browser assertion

`tests/visual/support/expect-absence.ts`:

- `expectAbsentWithin({ within, absent, present, because })` — the anchor is
  **required**. `expect(x).toHaveCount(0)` is satisfied equally by "the control is
  correctly not offered", "the page never mounted" and "somebody renamed the
  selector". `giggle-band.visual.spec.ts` carried exactly that vacuity: a
  `not.toContainText("Sign out")` on `.adl-topbar-tools` that would have survived
  the whole top bar disappearing.
- `expectRequestRefused(evidence, { url, status, reason })` — distinguishes the
  two failures a bare absence assertion conflates: a request never made, and one
  answered 2xx. Also declares its own allowance, so an asserted refusal is not
  additionally reported as an unexplained 4xx.
- `expectNoRequestTo(evidence, url)` — the affordance did not fire.
- `expectAuthorityDenied(evidence, { event, endpoint, reason })` — the **server**
  recorded the refusal. A control hidden by the UI is not the same fact as an
  action the server refuses: Phase 99 shipped a button the server would have
  refused, Phase 105 measured an enabled Accept button that is silently refused,
  and in both only the server-side record disambiguates. Pair it with
  `expectAbsentWithin`.

`page.request` shares the page context's cookie jar (measured), so driving the
endpoint a hidden control would have hit reaches the server as the *same*
principal, not a fresh anonymous one.

### `expectAuthorityDenied` cannot see a rejected *replay*

Found by the first spec to ask (Phase 105's `invitation` project, the first to
drive Jointly Care against an authority). A replay whose **outcome** is
`rejected` is recorded as `http_request` / `allowed` / `200` and nothing else:
the security log's `denied` events cover transport-level rejections —
`authority_request_rejected` for unauthenticated, bad origin, rate limited — and
not a policy verdict reached *inside* an accepted request.

So the one helper built for exactly this shape cannot see this shape. Measured
response, verbatim:

```
200 {"status":"rejected","operationId":"…","code":"ADL_POLICY_DENIED",
     "message":"Policy denied update on object 'CircleInvite' outside its runtime context scope."}
```

Transport succeeded; the write did not happen. Until the authority emits a
security event for a rejected outcome, the strongest available statements are the
outcome body (asserted on its `message`, not only its `code` — a bad CSRF token
is `403` and an expired session `401`, and neither must pass as the verdict under
test) and a read-back of the records the server did not write. Both are in
`tests/visual/invitation-accept.spec.ts`, with a comment saying why
`expectAuthorityDenied` is absent, so the next person does not rediscover it.

### An authority project needs a caller who is a member of nothing

The `passkey` and `administration` harnesses both seed a member or an
administrator, which is the caller whose path already worked.
`invitation-authority.ts` seeds an identity holding one `pending` invite and no
membership anywhere, and that difference immediately produced a finding no
hermetic test had: `AuthorityService.bootstrap` selects by read policy, no policy
lets a pending invitee read the context's own root record, and
`RuntimeContextService.mergeGrantedContexts` will not report an instance as
available without that record. The invitation reaches the device; the circle does
not; the screen has no context to render in. Neither reference app's invitation
flow works against a real deployment because of it.

### Gates prove they can fail, permanently

`tests/visual/evidence-self-check.spec.ts` gives each gate a `test.fail()` case
that provokes its signal unallowed, plus a counterpart proving the same signal
passes when declared. `test.fail()` **does** cover a failure raised in fixture
teardown, which is where the review happens (measured before it was relied on).
Delete or weaken a gate and its case becomes an *unexpected pass*, which turns the
suite red.

Run the mutation check when changing gate logic: remove each gate in turn and
confirm it breaks a **distinct** case. This is not ceremony — it caught two of
this suite's own `test.fail()` cases being vacuous. Aborting a request and
fetching a 404 both *also* log a console error, so the request-failed and
http-error cases still failed with their own gate deleted, satisfied by the
console gate instead. Each now allows the console error so the gate under test is
the only unallowed signal left. This is the same shape as Phase 103's vacuous
`SELF` negative: ask what constant would satisfy the assertion, and make sure the
mutation would catch it.

### No pixel baselines, and why

Measured against, not assumed. In favour: seed data is date-pinned
(`src/reference/band-app.ts` pins `now`, every date is a literal, the calendar's
month is a `defaultValue` in `ui.adlj`), the render path has no live clock
(`new Date()` appears twice in all of `src/ui`, neither rendered), and only five
CSS transitions exist. Against, decisively: `src/ui/styles.css` sets
`--adl-font-family: system-ui`, which fontconfig resolves differently per host,
and there is no CI — every run is somebody's laptop or a worktree on it. Churn
compounds it: of the last 100 commits, 52 touched `src/reference/**` and 63
touched `src/ui/**`, so baselines would need regenerating on three commits in
five, reviewed by the same human eyeball they were meant to replace.

The cheap prerequisite is already taken: the fixture injects a test-only
`--adl-font-family` override, so the largest flake source is gone before anyone
adds baselines. No production CSS changed.

### Server ownership is now checked, not remembered

The warm-port hazard above is enforced rather than documented. `globalSetup`
(`tests/visual/support/evidence-globals.ts`) reads `ss -ltnp` and
`/proc/<pid>/cwd` for all four ports and **fails the run** if one is served from
another working tree, recording the result in `test-results/visual/servers.json`.
A rule that can be mechanical should not be prose
(`learnings/process/instruction-placement.md`).
