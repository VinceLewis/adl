# Browser UI Runtime Implementation

Read this before changing browser UI components, runtime/UI policy integration, demo fixtures, or browser verification.

## Key decisions from Phase 4

- The browser demo uses native Web Components, not Lit, because the repository had no UI framework dependency and the brief asked for a framework-light runtime.
- Vite is the browser dev/build path. The top-level Vite dependency is pinned to the patched 6.x line because the newest major had stricter `@types/node` peer requirements than this repo's current pin.
- The browser entry point is `index.html` with `src/ui/main.ts`. The generic components live under `src/ui/components/`.
- `src/ui/demo-fixture.ts` owns the hardcoded resolved model fixture and seeding helper for `User` and `PurchaseOrder`. UI tests and the browser demo share this fixture.
- `adl-app` coordinates model, runtime, selected object, selected record, messages, and runtime commands. Data operations call `ApplicationRuntime`; components do not write store state directly.
- Field presentation is resolved in `src/ui/policy-presentation.ts` through the shared runtime `policyEngine`. Edit mode combines read policy and write policy so fields can be masked, hidden, or readonly. Create mode does not apply read masking to empty forms, otherwise required masked fields would become impossible to enter.
- Lifecycle action buttons are filtered by both current state and transition policy before rendering.
- Existing resolved theme tokens are applied by `adl-app` as CSS custom properties. Phase 5 should extend this foundation rather than replacing the UI styling path.
- UI tests use `happy-dom` with Vitest. They cover rendered workflows and direct runtime bypass enforcement for the same policy used by the UI.

## Practical guidance

- Keep UI behavior generic over `ResolvedObject` and `ResolvedView`; do not add per-object component forks.
- Add new UI workflows through `ApplicationRuntime` first, then expose presentation decisions through the same policy engine.
- When policy presentation blocks a field, make the UI skip that field in save patches so masked or readonly display values are not written back accidentally.
