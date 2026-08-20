# Phase 85 — Plain-Language Context-Cleared Message

> Commissioned directly by the user, from a real failure hit today: after
> clearing a browser's IndexedDB to work around an unrelated issue, reloading
> the app showed a cryptic two-line banner instead of a plain sentence. Per
> `learnings/process/phase-execution.md`'s standing rule for user-commissioned
> phases, this does not need to justify itself as the next item in a rolling
> handoff.
>
> This document is intentionally tiny: one string change, one call site, one
> existing test to update.

## Objective

Replace the current context-selection-cleared banner — title
`"<Context> selection was cleared."` plus a detail line exposing the raw,
no-longer-resolvable context id (`"Context '<uuid>' is no longer available to
this user."`) — with a single plain sentence: `"You must select a <Context>
to work with."` (e.g. `"You must select a Band to work with."` for the
Giggle Band reference app). No internal id, no jargon ("context"), no second
line.

## Evidence and Dependency

Re-verify against current code before executing.

- The message is built in `refreshAvailableContexts()`,
  `src/ui/components/adl-app.ts:2201-2206`:
  ```ts
  this.setSelectedContextId(contextModel.name, undefined, true);
  this.messages = [
    infoMessage(`${titleCaseIdentifier(contextModel.name)} selection was cleared.`, [
      `Context '${requested}' is no longer available to this user.`,
    ]),
  ];
  ```
  This fires whenever a previously-selected/persisted/route-supplied context
  id for any `ResolvedBusinessContext` is not among the ids
  `listAvailableContexts(...)` returns for that model — the exact case hit
  after an IndexedDB clear discards the persisted band selection while the
  runtime no longer recognizes the stale id.
- **This is generic shell-chrome code, not band-specific.** It runs once per
  entry in `this.navigableContexts` for *any* ADL app's *any* business
  context (band, or whatever context concept a future app defines), not only
  Giggle Band. `titleCaseIdentifier(contextModel.name)` already produces the
  capitalized context name elsewhere in this same file for comparable
  strings (e.g. `"Choose a Band context to open this view."`,
  `adl-app.ts:2272`) — follow that existing capitalization convention for
  the replacement string rather than inventing a new one.
- `infoMessage(title, details)` (`src/ui/runtime-error-messages.ts:18`) takes
  `details` as an optional array defaulting to `[]` — dropping the detail
  line entirely is a one-line change, not a signature change.
- **The only existing test coverage**: `tests/ui-runtime.test.ts`, test
  `"rejects invalid persisted and route-provided contexts"` (around lines
  1053-1077), asserts `textContent` contains `"Band selection was cleared."`
  in two places (persisted-selection case and route-param case). Neither
  assertion currently checks the detail line's exact text. Update both to
  assert the new sentence instead.
- No other source or test in the repository references this string (`grep -rn
  "no longer available\|selection was cleared"` across `src/` and `tests/`
  confirms only the one call site and the one test file).

## Decision

Change the call site to a single-line message with no details array:

```ts
this.messages = [
  infoMessage(`You must select a ${titleCaseIdentifier(contextModel.name)} to work with.`),
];
```

Keep using `titleCaseIdentifier(contextModel.name)` (not a hand-picked
lowercase string) so the fix stays generic across every ADL app's context
concepts, matching this file's existing convention rather than hardcoding
"band".

## Scope

- `src/ui/components/adl-app.ts`: the one call site in
  `refreshAvailableContexts()`.
- `tests/ui-runtime.test.ts`: update both assertions in `"rejects invalid
  persisted and route-provided contexts"` to the new sentence; also assert
  the raw context id no longer appears in the rendered output, so the id-leak
  this phase removes doesn't silently regress.

## Constraints

- Do not change `infoMessage`'s signature or `UiMessage`/`adl-message-area`
  rendering — only the call site's arguments.
- Do not touch `resolveRequestedContextId`, `setSelectedContextId`, or any
  other logic in `refreshAvailableContexts()` — this is a copy-only change.
- Do not hardcode "Band" — the fix must stay generic via
  `titleCaseIdentifier(contextModel.name)`, since this code path is shared by
  every business context in every ADL app.

## Deliverables

- Updated call site in `adl-app.ts`.
- Updated test assertions in `tests/ui-runtime.test.ts`.

## Acceptance Criteria

- Reloading with a stale/no-longer-available persisted or route-provided
  context id shows exactly one line: `"You must select a Band to work
  with."` for the Giggle Band app (and the equivalent for any other app's
  context name) — no raw id, no second line.
- `npm run typecheck`, `npm test`, and `npm run format:check` pass.
- `npm run verify:push` passes; the banner's new copy is visible in at least
  one generated screenshot and is inspected.

## Testing

- `npm test` — updated `tests/ui-runtime.test.ts` assertions.
- `npm run verify:push` — this changes rendered text in shell chrome
  (`src/ui/components/adl-app.ts`), so per `AGENTS.md`'s verification rule it
  must be run before pushing; inspect the screenshot showing the new banner
  text.

## Non-goals

- Redesigning the message banner's visual treatment (color, icon, layout) —
  copy only.
- Changing what triggers the banner, or adding a way to reselect a context
  directly from it — out of scope for this tiny fix.

## Dependencies

- `src/ui/components/adl-app.ts` (the call site).
- `src/ui/runtime-error-messages.ts` (`infoMessage`, read-only reference).
- `src/ui/components/html.ts` (`titleCaseIdentifier`, read-only reference).
- `tests/ui-runtime.test.ts` (assertions to update).

## Tasks

1. Re-verify the call site and test line numbers above against current code.
2. Change the `infoMessage(...)` call in `adl-app.ts`.
3. Update the two assertions in `tests/ui-runtime.test.ts`; add an assertion
   that the raw context id is absent from rendered output.
4. Run `npm test`, `npm run typecheck`, `npm run format:check`.
5. Run `npm run verify:push`; inspect the screenshot showing the new banner.
6. Commit and push.

## Planning Handoff

- None — this is a standalone, user-commissioned copy fix with no follow-on
  work implied. The next phase after this one is still whatever the highest-
  value repository-wide gap is (see `docs/phases/phase-84-startup-failure-recovery-ui.md`,
  already queued and not yet executed, for one candidate) — re-derive it at
  that time rather than treating this document as changing the queue.

## Closing Note

Executed. Changed the single call site in `refreshAvailableContexts()`
(`src/ui/components/adl-app.ts`) from the two-line `infoMessage(...)` (title
plus a detail line exposing the raw stale context id) to the one-line
`infoMessage(\`You must select a ${titleCaseIdentifier(contextModel.name)} to
work with.\`)` with no details array. Updated both assertions in
`tests/ui-runtime.test.ts`'s `"rejects invalid persisted and route-provided
contexts"` test to check for `"You must select a Band to work with."`, and
added `not.toContain("missing-band")` assertions in both cases so the id-leak
this phase removes cannot silently regress.

`npm run typecheck`, `npm test` (1069 tests, 59 files), and `npm run
format:check` all passed clean. `npm run verify:push` passed in full
(typecheck, format:check, test, build, and all 50 Playwright visual specs).
The banner is not exercised by any existing Playwright spec, so a throwaway
scratch test was added temporarily to `tests/visual/giggle-band.visual.spec.ts`
to seed a stale persisted Band context id, reload the real app, and screenshot
the result on both desktop and mobile viewports, then removed after
inspection (not committed). Both screenshots showed exactly one line, "You
must select a Band to work with.", with no raw id and no second line,
rendered in the same info-message banner style used elsewhere in the shell;
nothing else regressed.

Skipped a full `/impeccable audit` invocation, per the phase's own permission
to use judgment here: the change is copy-only text inside an existing,
unchanged `infoMessage`/`adl-message-area` component with no new markup, CSS,
layout, or color — it can only ever make the banner shorter (one line dropped)
than before. The manually captured desktop and mobile screenshots were
visually inspected directly and showed correct single-line rendering with no
overflow or regression, which is what an audit would have checked here.

Scope was kept to exactly the two files named in this phase document
(`src/ui/components/adl-app.ts`, `tests/ui-runtime.test.ts`). During
execution, an unrelated in-progress session's uncommitted work (Giggle Band's
`EventSetList` modeling) was independently committed by that session mid-task
(as `6b08065` and `9370283`); an earlier `git checkout --` used to discard a
scratch test accidentally targeted that file while it still had uncommitted
content, but the other session had already committed its own changes by that
point, so nothing was lost — confirmed by diffing against the post-commit
HEAD. No files outside this phase's stated scope were staged or committed.
