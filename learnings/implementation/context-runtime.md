# Context Runtime Implementation

Read this before changing runtime context resolution, context-scoped roles, scoped object authorization, context-aware UI calls, or tests that assert context policy behavior.

## Key decisions from Phase 13

- `RuntimeContext.roles` remains global-only. Context-scoped roles live in `RuntimeContext.contextRoles` with a context name, context instance id, role, and optional membership record id.
- `RuntimeContext.selectedContexts` carries selected business context ids by resolved context name, such as `{ Band: "<band-guid>" }`.
- `RuntimeContextService` resolves contexts from the resolved model and storage. It can list available context instances, validate a requested selection, resolve membership roles, and return a context enriched with the selected context and scoped roles.
- Membership resolution reads the configured membership object from runtime storage and matches `membership.userField` to `RuntimeContext.userId`. For context membership fixtures, tests use the ADL `User` record guid as the runtime user id.
- Policy role matching checks global roles first, then context roles. A context role only matches when the policy request targets the same context instance through an object scope field or a context object record id.
- Object scope enforcement is separate from UI and applies in `ObjectStore` and `LifecycleEngine` for create, read, search, update, delete, and transition. Scoped searches are filtered by the selected context or by resolved available context roles.
- A selected context narrows scoped operations to that context, even when the runtime context also carries roles for other instances of the same business context.
- Context scope denials are surfaced as `PolicyDeniedError` with structured decision reasons such as `<ObjectName>ContextScope`.

## Practical guidance

- Do not merge context roles into `RuntimeContext.roles`; that would turn a per-context role into a global principal.
- UI code should call `ApplicationRuntime.listAvailableContexts(...)` and `ApplicationRuntime.withSelectedContext(...)` rather than deriving context roles itself.
- Cross-context views should resolve available context roles through `runtime.contextService.resolveContextRoles(...)` and avoid setting `selectedContexts[contextName]` for that context.
- Keep context selection and role resolution in runtime services. UI hiding, routing, or persisted selection state must not be the only enforcement point.
