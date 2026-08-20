# Phase 82 — Reference-demo shell model migration

## Objective

Restore existing browser installations after Phase 80 changed resolved shell
content and therefore changed each application's model fingerprint.

## Evidence

An existing `http://localhost:5173/?demo=giggle-band` installation rendered a
blank page after a hard refresh. The console reported
`ADL_PERSISTED_MODEL_FINGERPRINT_STALE`: IndexedDB still held Giggle model
version `1.0.0` and its pre-Phase-80 fingerprint, while the new resolved model
also declared `1.0.0` but had different shell content.

The visual suite did not reproduce this because Playwright creates fresh
browser contexts and therefore had no pre-Phase-80 IndexedDB metadata. Its
screenshots proved clean-install rendering, not upgrade compatibility.

## Decision

- Keep the fail-closed fingerprint guard unchanged. Same-version content drift
  must remain an error.
- Advance Giggle Band and Jointly Care from `1.0.0` to `1.1.0` and declare an
  empty-object migration. Their record schemas did not change, so the migration
  atomically advances metadata while leaving every record byte-identical.
- Advance the persistent generic browser demo from `0.1.0` to `0.2.0` with the
  same no-record-change migration.
- Add a real IndexedDB regression that seeds a Giggle `1.0.0` record and stale
  fingerprint, starts the `1.1.0` runtime, and proves the record survives while
  metadata advances.

## Acceptance criteria

- A browser database written by Giggle `1.0.0` opens under `1.1.0` without
  clearing data.
- Startup reports `ADL_MODEL_MIGRATION_APPLIED` rather than throwing
  `RuntimeStartupError`.
- Persisted records remain byte-identical.
- Application metadata advances atomically to the current version and
  fingerprint.
- Fresh desktop/mobile browser rendering still passes and is visually
  inspected.

## Execution note

This is a corrective, user-directed phase. No later phase is implied; further
work remains user-directed.

## Completion review

- `npm run verify:push` passed: typecheck, formatting, 58 test files / 1,062
  tests, production build, and 46 Playwright desktop/mobile tests.
- The new browser regression seeds stale Giggle `1.0.0` metadata into the real
  `adl-giggle-band-example` IndexedDB database before opening
  `?demo=giggle-band`; both desktop and mobile runs rendered successfully and
  verified the metadata advanced to `1.1.0`.
- The generated persisted-upgrade screenshots were inspected. Both show the
  complete Giggle home screen rather than a blank document.
- The changed Giggle and Jointly `.adlj` sources compiled cleanly in the focused
  reference/compiler suite before the full gate.
- No later phase document needed revision. The separately authored Phase 81
  plan was left untouched; further work remains user-directed.
