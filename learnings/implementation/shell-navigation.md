# Shell Navigation Implementation

Read this before changing shell metadata, drawer navigation, top-bar controls,
or mobile business-context selection.

## Decisions From Phase 31

- Application shell metadata is top-level resolved model data on
  `ResolvedApplicationModel.shell`, not parser AST and not per-app browser
  branches.
- Resolver defaults create one nav item per resolved view, with derived labels,
  object-name groups, stable order, target-view active state, and `always`
  visibility.
- Auth and access remain runtime-policy concerns. Shell visibility can hide
  nav items or controls based on runtime context such as online state or
  business-context availability/selection, but it is not enforcement.
- The parser supports a global `SHELL` block with `NAV`, `CONTROL`, and
  `TOP_BAR` lines. The Giggle reference app uses this to declare Home, Gigs,
  Availability, Songs, Set Lists, and Bands labels without browser-specific
  branches.
- Browser drawer rendering consumes resolved shell nav metadata for labels,
  semantic icons, grouping, order, active state, and visibility.
- Top-bar context selection is a model-declared shell control. Mobile selector
  behavior defaults to `sheet`, rendering a compact selected-label trigger and
  modal sheet while preserving the desktop dropdown path.
- Optional shell controls include `contextSelector`, `syncStatus`,
  `themeSwitch`, `logout`, and `pwaInstall`. The current browser implements
  context selection and sync/online status; unavailable host capabilities
  degrade as disabled controls.

## Practical Guidance

- Add new shell behavior to the resolved shell contract first, then render it
  from `adl-app`. Do not infer application-specific navigation labels in the
  browser.
- Keep shell visibility predicates deliberately small unless a runtime service
  is added to evaluate richer shell policy. UI hiding must never be treated as
  policy enforcement.
- Validate shell references in `validateApplicationModel` with `ADL_SHELL_*`
  diagnostics before runtime startup.
- Update inspect/explain output whenever shell defaults or reference-bearing
  fields change.
