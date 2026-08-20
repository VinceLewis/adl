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
