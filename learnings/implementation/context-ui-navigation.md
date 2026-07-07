# Context UI and Navigation Implementation

Read this before changing context selectors, view navigation, dashboard rendering, or browser UI calls for context-scoped objects.

## Key decisions from Phase 14

- Context selection policy is now explicit in the resolved model: `mode`, `autoSelect`, `persistence`, `source`, and optional `routeParam`.
- Browser context selection is generic over resolved business contexts and views. The UI renders selectors for contexts referenced by model views; it does not hard-code app-specific navigation.
- Explicitly supplied `adl-app.runtime` instances are caller-managed and are not auto-seeded with the browser demo fixture.
- Required context views render an empty state when no valid selected context exists. Exactly one available context is auto-selected only when the resolved context policy allows it.
- Session/local persistence and route-provided context ids are treated as hints. The UI validates them with `ApplicationRuntime.listAvailableContexts(...)`; unavailable ids are cleared or rejected before scoped runtime calls run.
- Scoped standard views call `ApplicationRuntime.withSelectedContext(...)` before read/search/write operations. Create forms also inject the selected object scope field into submitted values when the scoped field is not part of the rendered form.
- All-context views deliberately remove `selectedContexts[contextName]`, resolve all available context roles through `runtime.contextService.resolveContextRoles(...)`, and pass those roles to runtime calls. This prevents a globally selected context from narrowing cross-context views.
- List-view create controls are gated by view actions, policy, sync state, and selected context.

## Practical guidance

- Keep context availability and role resolution in runtime services. UI storage, routes, and dropdowns are presentation state only.
- When adding dashboard/read-model views, reuse the active-view context resolution behavior so `context.mode: "all"` remains broad even if the user has selected a current context for other views.
- For scoped creates where the scope field is hidden from the form, preserve runtime enforcement by passing both the selected runtime context and the scope field value.
