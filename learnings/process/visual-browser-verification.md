# Visual Browser Verification

Read this before changing browser UI rendering, CSS, shell chrome, reference app
screens, or browser verification.

## Decisions

- Browser UI changes need real browser screenshots, not only DOM/unit tests.
  Happy DOM can prove behavior, but it will not catch spacing, clipping,
  wrapping, or viewport-specific composition issues.
- `npm run test:visual` is the Playwright visual smoke suite. It starts or reuses
  the Vite dev server, opens the Giggle Band app, visits every shell navigation
  page, and captures desktop and mobile screenshots.
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
