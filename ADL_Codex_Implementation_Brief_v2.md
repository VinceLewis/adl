# ADL Implementation Brief for Codex — Integrated v2

## Working Title

**ADL — Application Definition Language**

## Project and Reference Codebases

ADL project path:

```text
/home/vince/projects/personal/adl
```

Existing MINIL reference path:

```text
/home/vince/projects/personal/minil
```

Build ADL in `/home/vince/projects/personal/adl` as its own standalone codebase. Do **not** create the ADL implementation inside the MINIL repository, and do **not** make ADL depend on MINIL's build system or source tree.

Treat the existing MINIL project only as the source of prior ideas, parser/compiler experiments, examples, tests, and terminology. Do **not** continue the old transpiler-first direction as the main architecture.

The previous MINIL language transpiled to Dart/Flutter and Elixir/Phoenix LiveView. ADL is a revised architecture. Its centre is a **runtime model**, not generated application source code.

---

# 1. Executive Summary

ADL is the successor direction to MINIL.

It should define business applications in terms of:

```text
business objects
fields
relationships
business contexts
context scopes
lifecycles
states
transitions
policies
views
queries / read models
themes
sync behaviour
APIs
audit
```

The central architecture is:

```text
ADL source
  ↓
parser / validator
  ↓
partial application model
  ↓
resolved application model
  ↓
runtime engine
  ↓
UI + storage + policy + lifecycle + API behaviour
```

The runtime is the product. The language is the business-facing definition layer.

The developer or business analyst should mostly think in terms of:

```text
What object exists?
What fields does it have?
What lifecycle states can it be in?
What business contexts exist?
Which rows are scoped by which context?
Which views work inside one context, and which aggregate across contexts?
Who can see or change which rows and fields in each state?
What actions move it between states?
What views should exist?
What should sync locally?
```

They should not normally think about:

```text
SQL CRUD boilerplate
API route boilerplate
form widget code
client/server serialisation
state management
database engine selection
low-level validation plumbing
manual audit logic
hand-coded role checks
```

---

# 2. Non-Negotiable Architecture Boundaries

These boundaries are mandatory. They exist to prevent ADL becoming the old MINIL transpiler under a new name.

## Boundary 1 — No application-code generation as the main architecture

ADL may later generate helper files, schema files, migrations, documentation, type definitions, or SDK wrappers.

It must **not** generate the main application UI/business code in the old MINIL style.

The runtime executes the resolved model.

## Boundary 2 — The resolved model is the stable contract

The runtime must not depend directly on ADL syntax.

All runtime services consume:

```ts
ResolvedApplicationModel
```

not parser AST nodes.

ADL source, YAML fixtures, JSON fixtures, old-MINIL importers, visual designers, or AI assistants must all compile into the same resolved model.

## Boundary 3 — Separate language constructs from runtime behaviour

The ADL language and resolved model should describe business semantics:

```text
objects
fields
relationships
business contexts
context-scoped roles
lifecycles
policies
views
queries / read models
sync declarations
constraints
```

Runtime services decide how those semantics are executed:

```text
how a current context is selected and persisted
how context roles are resolved for a request
how queries are executed or materialised
how local database records sync with a remote authority
how a view is rendered as browser components
which server database, if any, backs shared data
```

Do not make implementation choices such as PostgreSQL tables, HTTP routes, IndexedDB object stores, localStorage keys, or calendar widgets into core ADL language constructs. ADL may declare enough structure for those runtime pieces to be generated or enforced later, but the language must remain business-facing.

## Boundary 4 — Policy is a runtime service, not a UI feature

The same policy decision must control:

```text
UI rendering
form editability
API writes
local writes
sync replay
imports
lifecycle transitions
reports
exports
```

The UI may hide buttons and fields, but the runtime must enforce the same decision again when the action is attempted.

## Boundary 5 — The browser is not trusted

Even if the browser performs local-first validation and policy checks, the authoritative server must re-check:

```text
identity
role
row permission
field permission
state permission
validation
lifecycle transition legality
base revision / conflict state
```

Local-first means optimistic local operation. It does not mean the browser becomes the system of record for shared enterprise data.

## Boundary 6 — Offline-first is an object policy, not a global rule

Default platform capability can be offline-first.

Individual objects still need explicit sync classification:

```text
LOCAL_FIRST
CACHE_READONLY
ONLINE_REQUIRED
LOCAL_PRIVATE
```

Do not blindly copy the whole enterprise database to every device.

## Boundary 7 — Defaults must be explicit and inspectable

Convention over configuration is correct, but invisible magic is dangerous.

ADL must support a fully inspectable resolved model:

```text
source definition
+ platform defaults
+ inherited defaults
+ explicit overrides
= resolved model
```

A developer should be able to ask:

```text
What exactly did ADL infer?
```

and receive a deterministic explanation.

---

# 3. Core Architectural Correction from MINIL

The old MINIL direction contained many good ideas, but it became expensive because it tried to be all of these at once:

```text
language
transpiler
database abstraction
UI framework
workflow engine
auth engine
offline engine
test framework
migration tool
IDE language server
AI generation target
Dart emitter
LiveView emitter
```

ADL must not begin by implementing all of that.

The key change is:

```text
Old MINIL:
MINIL source → Dart/Flutter or Elixir/LiveView generated application

New ADL:
ADL source → resolved model → runtime executes/interprets model
```

In the new design, application improvements happen by improving the runtime, not by regenerating thousands of lines of application code.

Example:

If we add better field-level undo, accessibility, search, audit display, mobile layout, or offline warnings, we should change the runtime once and all ADL applications benefit.

---

# 4. What to Preserve from MINIL

Inspect the existing MINIL reference codebase and documentation. Preserve concepts where useful, but not necessarily code.

## 4.1 Preserve strongly

### Schema/data concepts

From MINIL, preserve the conceptual value of:

```text
FILE / COLUMNS
KEY
implicit _GUID
AUTO.ID
AUTO.NUM
LOOKUP
REQUIRED
DEFAULT
VALIDATE
TEXT / NUM / DATE / TIME / BOOL / ATTACHMENT
DATE(WITH.TIME)
```

In ADL these should become:

```text
OBJECT
FIELD
RELATIONSHIP
IDENTITY
VALIDATION
DEFAULT
```

The implicit GUID concept is especially important.

ADL should distinguish:

```text
system identity     immutable internal GUID
business key        human/business identifier
display label       friendly value shown in UI
```

This mirrors successful enterprise systems: ServiceNow `sys_id`, Salesforce Id, Dataverse row ID, and similar system identities.

### UI concepts

Preserve the concept of standard generated UI patterns:

```text
LIST
DETAIL
FORM
MASTER_DETAIL
COMPOSITE
GRID
DASHBOARD
```

However, views should be runtime-rendered from the resolved model, not generated as full bespoke application code.

Do not add a calendar view as a required first-class ADL interface just because a domain has dated events. Calendars are often data-thin and leave large empty regions. For many business applications, an event list grouped by date is denser, more searchable, more accessible, and can still be rendered from a normal list view over date-sorted records.

The MVP should treat a date picker as a field widget for `DATE` and `DATETIME` fields. Rich calendar, timeline, scheduler, map, kanban, or matrix presentations can be runtime view components later, but only when they correspond to reusable view semantics in the resolved model. They should not become bespoke application code or mandatory ADL language constructs.

### Workflow concepts

Preserve:

```text
WORKFLOW
STATE
ON.ENTER
ON.EVENT
ON.TIMEOUT
GOTO
BY.ROLE
```

But rename and reframe them as:

```text
LIFECYCLE
STATE
TRANSITION
ACTION
```

A lifecycle is a first-class property of a business object.

### Access concepts

Preserve and extend:

```text
ROLE
GROUP ROLE
MEMBER ROLE
ACCESS
READ/WRITE/DELETE
OWN/ANY
```

But ADL needs finer-grained policy than old MINIL:

```text
row-level permission
field-level permission
state-specific permission
action-specific permission
context-specific permission
```

The central policy question is:

```text
can(principal, action, object, row, field?, state, context) -> allow | deny | readonly | mask | hidden
```

### Context and scope concepts

ADL must distinguish identity context from business context.

Examples:

```text
current user
current band
current project
current customer account
current workspace
all contexts available to the current user
```

A business context is not just a lookup field. It can affect:

```text
navigation
default filters
row permissions
field permissions
role meaning
sync dataset selection
offline snapshot shape
view availability
cross-context dashboards
```

ADL should eventually model these as first-class resolved-model concepts:

```text
CONTEXT              the business scope, such as Band or Project
CONTEXT MEMBERSHIP   how users belong to context instances
CONTEXT ROLE         role within a context instance, such as Admin in one band
OBJECT SCOPE         which context, if any, owns each object row
VIEW CONTEXT         whether a view requires one context, allows one, or spans many
QUERY / READ MODEL   reusable cross-object or cross-context projection
```

Runtime behaviour remains separate. The runtime may choose to persist a selected context in local storage, derive it from a URL parameter, auto-select when only one context exists, or force the user to choose. Those are runtime and UI behaviours, not ADL syntax.

### Testing concepts

Preserve the idea of model-level acceptance tests:

```text
GIVEN
RUN
EXPECT
ASSERT
```

But defer implementation until the runtime slice is stable.

---

# 5. What to De-emphasise or Remove from the Main Authoring Surface

The old MINIL procedural layer is useful background, but should not dominate ADL.

Do not make these the centre of ADL:

```text
FETCH
STORE
LOOP
SET
REPEAT
CHECK
DART.INLINE
SQL.INTO
```

These are implementation-level or escape-hatch concepts.

They may survive internally or later as advanced hooks, but ordinary ADL applications should be authored declaratively.

A business object state transition should usually be defined like this conceptually:

```text
ACTION approve
  FROM Submitted
  TO Approved
  ALLOWED BY ROLE Approver
```

Not like this:

```text
FETCH FILE(REQUESTS) KEY(#REQID)
SET @REQUESTS.STATUS TO 'APPROVED'
STORE FILE(REQUESTS) MODE(UPDATE)
```

The runtime should already know how to update state, audit the transition, validate policy, and persist the change.

---

# 6. Recommended ADL Language Direction

> **Superseded, on who authors new content.** This section's call — ADL text
> as the primary authoring language, YAML/JSON as secondary — held through
> Phase 72. Phase 73 added `.adlj`, a JSON authoring surface with a real JSON
> Schema (`src/model/adlj-schema.json`); by the time an `.adl` → `.adlj`
> importer and full printer coverage landed (Phases 77-79), the balance this
> section describes had inverted for anything an LLM generates rather than a
> person hand-types: `.adlj` is now the primary authoring surface, and `.adl`
> text is the *derived*, human-reviewable view rendered from it via
> `print-adl.ts` — not a source to hand-author for new work. See
> `docs/spec/adlj.md` (its "Authoring a `.adlj` document from scratch"
> section) and `AGENTS.md`/`CLAUDE.md`'s "Read Before Working" for the
> current guidance. The architecture reasoning below — a readable authoring
> surface, business-readable rather than raw-format-first, everything
> resolving to the same model — still holds; only which concrete surface a
> new author (increasingly, an LLM) writes to first has changed.

ADL should be its own readable authoring language, not raw YAML as the primary language.

YAML and JSON are still useful for:

```text
intermediate representation
tests
fixtures
JSON Schema tooling
import/export
early prototyping
```

But the authored language should be business-readable.

Proposed initial syntax style:

```adl
APP CareOps
  THEME CorporateLight
  START_VIEW PatientList
END.APP

OBJECT Patient
  KEY PatientNumber
  DISPLAY Name

  FIELD PatientNumber TEXT REQUIRED AUTO_ID PREFIX('PAT-') PAD(6)
  FIELD Name TEXT(100) REQUIRED
  FIELD DateOfBirth DATE
  FIELD Status TEXT DEFAULT('Draft') IN('Draft','Active','Suspended','Archived')

  LIFECYCLE PatientLifecycle FIELD Status
    STATE Draft
    STATE Active
    STATE Suspended
    STATE Archived

    ACTION activate FROM Draft TO Active
      ALLOW ROLE Admin
    END.ACTION

    ACTION suspend FROM Active TO Suspended
      ALLOW ROLE Admin
    END.ACTION
  END.LIFECYCLE

  VIEW PatientList LIST
    FIELDS PatientNumber Name Status
    SEARCH Name PatientNumber
  END.VIEW

  VIEW PatientEdit FORM
    FIELDS PatientNumber Name DateOfBirth Status
  END.VIEW
END.OBJECT
```

However, do not over-invest in final syntax until the resolved model is defined.

The first deliverable is not perfect syntax. The first deliverable is:

```text
a stable resolved model
a model validator
a runtime that can execute one small model
```

Recommended bootstrap sequence:

```text
1. Hardcoded TypeScript model
2. JSON model fixture
3. YAML model fixture
4. ADL parser
5. ADL language server
```

The authored ADL language remains the destination, not the first dependency.

---

# 7. Resolved Model First

Create one canonical internal model format. Prefer JSON-compatible TypeScript interfaces.

The resolved model is the only thing the runtime consumes.

All authoring formats compile into this resolved model.

Initial TypeScript shape:

```ts
export interface ResolvedApplicationModel {
  modelVersion: string;
  generatedAt?: string;
  app: ResolvedApp;
  objects: ResolvedObject[];
  contexts?: ResolvedContext[];
  queries?: ResolvedQuery[];
  roles: ResolvedRole[];
  policies: ResolvedPolicy[];
  themes: ResolvedTheme[];
  sync: ResolvedSyncPolicy[];
}

export interface ResolvedApp {
  name: string;
  startView: string;
  theme: string;
}

export interface ResolvedObject {
  name: string;
  schemaVersion: number;
  tableName: string;
  systemIdField: string;
  businessKey?: string;
  displayField?: string;
  scope?: ResolvedObjectScope;
  fields: ResolvedField[];
  lifecycle?: ResolvedLifecycle;
  views: ResolvedView[];
  sync?: ResolvedObjectSyncPolicy;
}

export interface ResolvedField {
  name: string;
  storageName: string;
  type: "text" | "number" | "date" | "datetime" | "time" | "boolean" | "attachment";
  required: boolean;
  defaultValue?: unknown;
  validators: ResolvedValidator[];
  readonly?: boolean;
  hidden?: boolean;
  lookup?: ResolvedLookup;
  autoId?: ResolvedAutoId;
}

export interface ResolvedValidator {
  kind:
    | "email"
    | "min"
    | "max"
    | "minLength"
    | "maxLength"
    | "in"
    | "regexp"
    | "currencyCode"
    | "maxSize"
    | "mimeType";
  value?: unknown;
}

export interface ResolvedLookup {
  targetObject: string;
  targetField?: string;
  displayField: string;
}

export interface ResolvedAutoId {
  prefix?: string;
  pad?: number;
  scopeField?: string;
}

export interface ResolvedLifecycle {
  name: string;
  stateField: string;
  states: ResolvedState[];
  actions: ResolvedLifecycleAction[];
}

export interface ResolvedState {
  name: string;
  terminal?: boolean;
}

export interface ResolvedLifecycleAction {
  name: string;
  from: string[];
  to: string;
  label?: string;
  policyRefs: string[];
  hooks?: ResolvedHookRefs;
}

export interface ResolvedHookRefs {
  before?: string[];
  after?: string[];
  onError?: string[];
}

export interface ResolvedPolicy {
  name: string;
  object: string;
  effect: "allow" | "deny" | "readonly" | "mask" | "hidden";
  principal: ResolvedPrincipalSelector;
  action: string;
  state?: string | string[];
  fields?: string[];
  condition?: string;
}

export interface ResolvedPrincipalSelector {
  roles?: string[];
  groupRoles?: string[];
  users?: string[];
  owner?: boolean;
}

export interface ResolvedView {
  name: string;
  object: string;
  kind: "list" | "detail" | "form" | "dashboard" | "masterDetail" | "grid" | "composite";
  context?: ResolvedViewContext;
  fields: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  actions?: string[];
}

export interface ResolvedSort {
  field: string;
  direction: "asc" | "desc";
}

export interface ResolvedTheme {
  name: string;
  base?: string;
  tokens: ResolvedThemeTokens;
}

export interface ResolvedThemeTokens {
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
  colorText: string;
  radius: "none" | "small" | "medium" | "large";
  density: "compact" | "comfortable" | "spacious";
  nav: "top" | "side" | "bottom";
  fontFamily?: string;
  logoUrl?: string;
}

export interface ResolvedSyncPolicy {
  object: string;
  mode: "localFirst" | "cacheReadonly" | "onlineRequired" | "localPrivate";
  scope?: "all" | "assignedToUser" | "ownedByUser" | "recent" | "custom";
  conflict?: "serverWins" | "clientWins" | "stateTransitionWins" | "manual";
}

export type ResolvedObjectSyncPolicy = Omit<ResolvedSyncPolicy, "object">;
```

This will evolve, but Codex should create this model explicitly and keep it separate from parser details.

## 7.1 Contexts, scopes and read models

Context support belongs in the resolved model before it belongs in parser syntax.

The language should eventually let authors declare business contexts in business terms. The runtime should then decide how to resolve, persist, validate and expose the current context for a request.

Recommended model direction:

```ts
export interface ResolvedContext {
  name: string;
  object: string;
  identityField: string;
  displayField: string;
  membership?: ResolvedContextMembership;
  selection: ResolvedContextSelectionPolicy;
}

export interface ResolvedContextMembership {
  object: string;
  userField: string;
  contextField: string;
  roleField?: string;
}

export interface ResolvedContextSelectionPolicy {
  required: boolean;
  default: "none" | "firstAvailable" | "onlyAvailable" | "lastUsed";
  persistence: "none" | "session" | "local";
  sourceOrder: ("runtime" | "route" | "storage")[];
}

export interface ResolvedObjectScope {
  context: string;
  field: string;
  required: boolean;
}

export interface ResolvedViewContext {
  mode: "requiresContext" | "optionalContext" | "allAvailableContexts";
  context?: string;
}

export interface ResolvedQuery {
  name: string;
  kind: "object" | "projection" | "aggregate";
  context?: ResolvedViewContext;
  sources: ResolvedQuerySource[];
  fields: ResolvedQueryField[];
  sort?: ResolvedSort[];
}

export interface ResolvedQuerySource {
  object: string;
  alias?: string;
  scope?: "currentContext" | "allAvailableContexts" | "currentUser" | "all";
}

export interface ResolvedQueryField {
  name: string;
  source?: string;
  field?: string;
  type: "text" | "number" | "date" | "datetime" | "time" | "boolean";
}
```

These are model concepts, not runtime algorithms. For example, `ResolvedContextSelectionPolicy` says that an application has a selected context concept and how it should behave from the user's perspective. It does not require localStorage, a modal, a URL parameter, or a particular browser implementation.

Queries/read models should cover cross-context dashboards without forcing bespoke SQL into ADL. A runtime might execute them over IndexedDB, SQLite, PostgreSQL, a cached API response, or a materialised local table. The resolved model should describe the projection and security boundary; the backend chooses the execution plan.

---

# 8. Record Metadata Must Be Designed Early

Every persisted object record should have platform metadata, even if hidden from normal ADL authors.

Recommended internal fields:

```text
_guid              immutable system identity
_object            object type
_schemaVersion     object schema/model version
_revision          optimistic concurrency revision
_state             current lifecycle state, or configured state field
_createdAt
_createdBy
_updatedAt
_updatedBy
_deletedAt         tombstone timestamp, null if active
_deletedBy
_syncStatus        local/pending/synced/conflict/rejected
```

Do not physically delete shared records initially. Use tombstones. This matters for sync, audit and conflict handling.

Recommended TypeScript shape:

```ts
export interface PlatformRecordMetadata {
  guid: string;
  object: string;
  schemaVersion: number;
  revision: string;
  state?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string;
  deletedBy?: string;
  syncStatus: "local" | "pending" | "synced" | "conflict" | "rejected";
}

export interface StoredObjectRecord {
  meta: PlatformRecordMetadata;
  values: Record<string, unknown>;
}
```

---

# 9. Policy Model

The policy engine is one of the most important parts of ADL.

It must be deterministic, explainable and shared across UI, runtime, API and sync.

## 9.1 Recommended policy request/decision shape

```ts
export interface RuntimeContext {
  userId: string;
  roles: string[];
  groups?: Record<string, string[]>;
  contexts?: Record<string, string>;
  contextRoles?: Record<string, string[]>;
  now: Date;
  channel: "ui" | "api" | "sync" | "import" | "test";
}

export interface PolicyRequest {
  object: string;
  action:
    | "create"
    | "read"
    | "update"
    | "delete"
    | "search"
    | "transition"
    | "export"
    | "import";

  record?: Record<string, unknown>;
  field?: string;
  currentState?: string;
  targetState?: string;
  lifecycleAction?: string;
  patch?: Record<string, unknown>;
  channel: "ui" | "api" | "sync" | "import" | "test";
}

export interface PolicyDecision {
  effect: "allow" | "deny" | "readonly" | "mask" | "hidden";
  reasons: PolicyDecisionReason[];
}

export interface PolicyDecisionReason {
  policyName: string;
  ruleName?: string;
  message: string;
}
```

## 9.2 Required evaluation rules

Use these rules until there is a reason to change them.

```text
1. Default is deny.
2. Explicit deny always wins.
3. Field policy can restrict row policy, but cannot expand it.
4. Lifecycle action policy is required for transitions.
5. Update of a field requires both:
   - row-level update permission
   - field-level update permission, unless the object explicitly sets fieldDefault: inherit
6. Read of a field requires both:
   - row-level read permission
   - field-level read permission, unless fieldDefault: inherit
7. Mask/hidden/readonly are not errors; they are presentation/data-shaping decisions.
8. Every policy decision must be explainable.
9. The same policy engine must be used by UI and runtime enforcement.
10. The server must re-evaluate policy for synchronised operations.
11. Context-scoped roles are not global roles. A user may be Admin in one context instance and Member in another.
12. Relationship-aware policy must be enforceable by the runtime, not only by hiding UI controls.
```

Runtime context is request state. It may contain already-resolved business context IDs and context roles, but ADL source should not specify how the browser or server obtained them. Context resolution belongs in a runtime service.

## 9.3 Suggested ADL policy syntax for later

Do not implement this syntax first. Implement the model first.

This is the direction ADL should move towards:

```adl
POLICY PurchaseOrderPolicy ON PurchaseOrder
  DEFAULT DENY

  ROW STATE Draft
    ALLOW READ ROLE Requester Buyer Admin
    ALLOW UPDATE ROLE Requester Buyer
    ALLOW DELETE ROLE Requester
  END.ROW

  ROW STATE Submitted
    ALLOW READ ROLE Requester Buyer Approver Admin
    ALLOW UPDATE ROLE Buyer Approver
    DENY DELETE ROLE Requester Buyer Approver
  END.ROW

  ROW STATE Approved
    ALLOW READ ROLE Requester Buyer Approver Auditor Admin
    DENY UPDATE ROLE Requester Buyer Approver Auditor
    DENY DELETE ROLE Requester Buyer Approver Auditor
  END.ROW

  FIELD InternalNotes
    HIDDEN ROLE Requester
    ALLOW READ ROLE Buyer Approver Auditor Admin
    ALLOW UPDATE ROLE Buyer Admin STATE Draft Submitted
  END.FIELD

  FIELD Value
    ALLOW READ ROLE Requester Buyer Approver Auditor Admin
    ALLOW UPDATE ROLE Requester STATE Draft
    ALLOW UPDATE ROLE Buyer STATE Submitted
    READONLY STATE Approved
  END.FIELD

  ACTION approve
    ALLOW ROLE Approver STATE Submitted
  END.ACTION
END.POLICY
```

---

# 10. Offline-First and Sync

Offline-first should be a platform capability, but not a blind rule for every object.

For serious business applications, local-first must sync operations, not just rows.

## 10.1 Object sync modes

Support these sync modes in the model:

```text
LOCAL_FIRST
CACHE_READONLY
ONLINE_REQUIRED
LOCAL_PRIVATE
```

Semantics:

```text
LOCAL_FIRST:
  read/write locally; sync when online

CACHE_READONLY:
  read local cache; writes require online/server

ONLINE_REQUIRED:
  no local access except perhaps temporary UI state

LOCAL_PRIVATE:
  local data only; never sync
```

Example:

```adl
OBJECT WorkOrder
  SYNC LOCAL_FIRST SCOPE AssignedToUser CONFLICT StateTransitionWins
END.OBJECT

OBJECT AuditEvent
  SYNC ONLINE_REQUIRED
END.OBJECT

OBJECT ProductCatalogue
  SYNC CACHE_READONLY SCOPE ActiveOnly
END.OBJECT
```

## 10.2 Operation log

When a user does something locally, record an operation:

```ts
export interface LocalOperation {
  opId: string;
  object: string;
  recordId: string;
  baseRevision?: string;
  operation:
    | "create"
    | "update"
    | "delete"
    | "transition";

  patch?: Record<string, unknown>;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;

  createdAt: string;
  createdBy: string;
  contextSnapshot: {
    roles: string[];
    channel: "ui" | "api" | "sync";
  };

  status: "pending" | "sent" | "accepted" | "rejected" | "conflict";
  serverMessage?: string;
}
```

This is important because a lifecycle transition is not merely a row update.

This:

```text
Submitted → Approved
```

should sync as:

```text
approve purchase order PO123 from revision 8
```

not merely:

```text
set status = Approved
```

The server can then decide whether the operation is still valid.

Example:

```text
Local operation:
  Approver approves PO123 while offline from revision 8.

Server state when sync occurs:
  PO123 is already Cancelled at revision 10.

Result:
  Reject operation as invalid transition.
  Keep local audit of attempted operation.
  Notify user.
```

## 10.3 Sync is deferred but modelled early

Full sync implementation is not part of the first runtime slice.

However, the model and local operation log design should be included early so storage is not designed incorrectly.

## 10.4 Local database first, remote authority later

The local database is not a throwaway prototype. It is part of the correct shape for offline-first applications.

The early runtime should prove:

```text
resolved model
local object storage
policy enforcement
lifecycle enforcement
operation log
sync classification
```

before committing to a particular authoritative server backend.

PostgreSQL may be a good later backend for shared data, relational constraints, reporting, and authoritative sync. It is not required as an ADL language dependency, and it is not required before the local runtime shape is stable.

ADL should model business constraints and scopes in backend-neutral terms:

```text
required fields
lookup relationships
context-scoped uniqueness
referential delete behaviour
authoritative policy checks
sync windows / datasets
read models
```

A PostgreSQL backend could enforce those with enums, foreign keys, unique indexes, check constraints, transactions, and materialised views. A different backend could enforce the same semantics differently. ADL should not expose SQL DDL or SQL query text as the normal authoring surface.

---

# 11. Model Versioning and Migrations

Add model versioning before IndexedDB/SQLite persistence becomes real.

Recommended model additions already appear in the resolved model:

```text
ResolvedApplicationModel.modelVersion
ResolvedObject.schemaVersion
```

Later, add migration declarations:

```adl
MIGRATION PurchaseOrder FROM 1 TO 2
  ADD FIELD ApprovalComment TEXT
  SET DEFAULT ApprovalComment TO ''
END.MIGRATION
```

Do not implement full migrations in the MVP, but ensure storage records know which schema version created them.

Minimum MVP behaviour:

```text
record stores _schemaVersion
runtime refuses to open incompatible records without a migration path
diagnostic explains the problem
```

---

# 12. Hooks

Avoid recreating `DART.INLINE` under a new name.

If custom behaviour is needed, use named hooks registered in the host runtime.

ADL should refer to hook names:

```adl
ACTION approve FROM Submitted TO Approved
  BEFORE hooks.purchaseOrder.validateBudget
  AFTER hooks.purchaseOrder.notifyRequester
END.ACTION
```

Runtime registration:

```ts
runtime.registerHook("hooks.purchaseOrder.validateBudget", async (ctx) => {
  // TypeScript code here, outside the ADL file.
});
```

This keeps ADL declarative and keeps custom code testable.

MVP may define hook references in the model without implementing a full hook ecosystem.

---

# 13. Theme and Branding System

Customer branding is a real requirement, not an afterthought.

The platform should let a customer pick a base theme and customise tokens.

Customers should customise:

```text
base theme
logo
primary colour
accent colour
surface/background colours
font
spacing/density
border radius
navigation position
light/dark mode
```

Customers should not normally customise widget trees.

Theme example:

```adl
THEME AcmeTheme BASE CorporateLight
  LOGO 'assets/acme.svg'
  PRIMARY '#0047AB'
  ACCENT '#00A676'
  DENSITY Compact
  RADIUS Medium
  NAV Side
END.THEME
```

Runtime implementation should use CSS custom properties:

```css
:root {
  --adl-color-primary: #0047AB;
  --adl-color-accent: #00A676;
  --adl-radius: 8px;
}
```

---

# 14. Implementation Stack

Use a stack appropriate for local-first browser/runtime development.

Recommended initial stack:

```text
Language: TypeScript
Runtime target: Browser/PWA
UI: Web Components or Lit
Storage: in-memory first, then IndexedDB, then SQLite WASM + OPFS
Model format: JSON-compatible resolved model
Authoring language: ADL text syntax
Parser: initially hand-written recursive descent or Chevrotain if helpful
Validation: TypeScript validator first; JSON Schema can follow
Server later: optional authoritative sync service; Go + PostgreSQL is one candidate
Sync later: object-level local-first sync
```

Superseded on the "Authoring language" line specifically: `.adlj` (JSON,
schema-validated) is now the primary authoring surface for new content, with
`.adl` text generated from it for human review — see the note under "6.
Recommended ADL Language Direction" above and `docs/spec/adlj.md`. Every
other line in this stack held.

Do not introduce React, Vue, Angular, Flutter, LiveView, or code generation at the start unless there is a strong reason.

The runtime must be framework-light.

The browser should be treated as the terminal/rendering layer for a business runtime.

---

# 15. Repository Strategy

Use `/home/vince/projects/personal/adl` as the top-level ADL repository.

ADL must be a distinct codebase from MINIL:

```text
/home/vince/projects/personal/adl     # new ADL implementation
/home/vince/projects/personal/minil   # old MINIL reference project only
```

Do not create `/home/vince/projects/personal/minil/adl`, and do not move old MINIL code into this repository. MINIL can be inspected and documented as prior art, but new ADL implementation files belong under `/home/vince/projects/personal/adl`.

Suggested structure:

```text
/home/vince/projects/personal/adl/
  README.md
  NOTES_FROM_MINIL.md
  package.json
  tsconfig.json
  src/
    model/
      resolved-model.ts
      defaults.ts
    parser/
      lexer.ts
      parser.ts
      ast.ts
    compiler/
      compile-adl.ts
      resolve-model.ts
      validate-model.ts
    runtime/
      application-runtime.ts
      object-store.ts
      policy-engine.ts
      lifecycle-engine.ts
      validation-engine.ts
      view-renderer.ts
      audit-service.ts
      operation-log.ts
      hook-registry.ts
    ui/
      components/
        adl-app.ts
        adl-list-view.ts
        adl-form-view.ts
        adl-field-renderer.ts
        adl-action-bar.ts
      theme/
        theme-types.ts
        default-theme.ts
  docs/
    adr/
      0001-runtime-model-not-transpiler.md
      0002-resolved-model-is-stable-contract.md
      0003-policy-engine-single-source-of-truth.md
      0004-offline-first-as-object-sync-policy.md
      0005-no-inline-code-in-adl-mvp.md
      0006-browser-runtime-is-not-authoritative-server.md
  examples/
    user.adl
    purchase-order.adl
    user.model.json
    purchase-order.model.json
  tests/
    parser.test.ts
    model-resolution.test.ts
    model-validation.test.ts
    policy-engine.test.ts
    lifecycle-engine.test.ts
    runtime-crud.test.ts
```

Do not try to reuse the MINIL build system. Start ADL as a standalone TypeScript package in this repository until proven otherwise.

---

# 16. Architecture Decision Records

Ask Codex to create lightweight Architecture Decision Records.

Suggested folder:

```text
docs/adr/
```

Initial ADRs:

```text
0001-runtime-model-not-transpiler.md
0002-resolved-model-is-stable-contract.md
0003-policy-engine-single-source-of-truth.md
0004-offline-first-as-object-sync-policy.md
0005-no-inline-code-in-adl-mvp.md
0006-browser-runtime-is-not-authoritative-server.md
```

Each ADR should include:

```text
Context
Decision
Consequences
Rejected alternatives
```

These ADRs will help stop future work drifting back towards the old approach.

---

# 17. Phased Implementation Plan

## Phase 0 — Repository Audit

### Goal

Understand what exists in old MINIL and identify reusable assets.

### Tasks

1. Inspect the old MINIL reference repository without modifying it:

```bash
cd /home/vince/projects/personal/adl
find ../minil -maxdepth 3 -type f | sort | sed 's#^\.\./minil/##'
```

2. Identify:

```text
parser code
lexer code
AST structures
validator code
Dart emitter
LiveView emitter
test examples
language specs
example MINIL applications
```

3. Create `NOTES_FROM_MINIL.md` listing:

```text
reusable concepts
reusable code
discarded code
risks
```

4. Create the first ADRs:
   - runtime model, not transpiler
   - resolved model is stable contract

### Acceptance Criteria

- Codex can explain the old MINIL repository shape and this ADL repository shape.
- No old MINIL code is modified.
- ADL repository exists independently at `/home/vince/projects/personal/adl`.
- Initial ADRs exist.

---

## Phase 1 — Define the Resolved Model

### Goal

Create the canonical runtime model before building a parser.

### Tasks

1. Create `src/model/resolved-model.ts`.
2. Define TypeScript interfaces for:
   - app
   - object
   - field
   - validators
   - lookup
   - lifecycle
   - lifecycle action
   - policy
   - view
   - theme
   - sync policy
   - record metadata
   - local operation log
3. Create `src/model/defaults.ts`.
4. Implement default resolution functions:
   - table name from object name
   - storage name from field name
   - implicit `_guid`
   - default metadata fields
   - default lifecycle state field
   - default views if none specified
   - default sync mode
   - default deny policy

### Key Principle

Every ADL application should have a fully inspectable resolved model.

There must be a function:

```ts
resolveApplicationModel(input: PartialApplicationModel): ResolvedApplicationModel
```

and ideally:

```ts
explainResolvedModel(model: ResolvedApplicationModel): string
```

This is important because defaults must not be invisible magic.

### Acceptance Criteria

- A hardcoded partial model can be resolved.
- The resolved model includes explicit defaults.
- Tests prove default resolution is deterministic.
- Resolved model contains modelVersion and object schemaVersion.
- Record metadata model exists.

---

## Phase 2 — Model Validator

### Goal

Validate the resolved model before runtime execution.

### Tasks

Create `src/compiler/validate-model.ts`.

Validation examples:

```text
object names unique
field names unique within object
business key field exists
display field exists
lifecycle state field exists
lifecycle action from/to states exist
policy object exists
policy field references exist
view field references exist
required fields have compatible defaults
autoId only on text fields
lookup target object exists
sync mode is valid
theme references are valid
hook references are syntactically valid
```

### Output

Use structured diagnostics:

```ts
export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  sourceRange?: SourceRange;
}
```

Do not just throw strings. Diagnostics will later feed VS Code/LSP.

### Acceptance Criteria

- Validator returns multiple errors at once.
- Diagnostics contain stable error codes.
- Tests cover invalid object, field, lifecycle, policy, sync, hook and view references.

---

## Phase 3 — Minimal Runtime Without Parser

### Goal

Prove the runtime can execute a resolved model before building the ADL syntax.

### Tasks

Build runtime over a hardcoded JSON/TypeScript model.

Runtime services:

```text
ValidationEngine
PolicyEngine
LifecycleEngine
ObjectStore
AuditService
OperationLog
HookRegistry
ApplicationRuntime
```

### Initial ObjectStore

Use in-memory storage first.

Implement:

```ts
create(objectName, values, context)
read(objectName, id, context)
update(objectName, id, patch, context)
delete(objectName, id, context)
search(objectName, query, context)
transition(objectName, id, actionName, context)
```

### Required enforcement

Runtime must enforce policy itself.

The UI must not be trusted.

### Acceptance Criteria

- Can create a User.
- Can search users.
- Can update a User.
- Can block an update by policy.
- Can transition a lifecycle state.
- Invalid transitions are rejected.
- Audit events are recorded.
- Runtime denies unauthorised operations even if called directly without UI.
- Operation log records local create/update/delete/transition.

---

## Phase 4 — Browser UI Runtime

### Goal

Render standard business UI from the resolved model.

### Tasks

Implement lightweight components:

```text
adl-app
adl-list-view
adl-form-view
adl-field-renderer
adl-action-bar
adl-message-area
```

Minimum UI:

```text
list view
search box
new button
row select
edit form
save
delete
lifecycle action buttons
field validation display
field-level readonly/hidden/masked policy behaviour
```

### Design Rule

No per-object hand-written UI.

The same component must render all simple objects.

### Acceptance Criteria

- One hardcoded model renders a working User list and form.
- Policy can make a field readonly, hidden or masked.
- Lifecycle actions appear/disappear according to policy and state.
- Runtime still enforces policy if UI is bypassed.
- Theme tokens affect visible styling.

---

## Phase 5 — Theme System

### Goal

Support customer branding without custom widget trees.

### Tasks

Implement the `ResolvedTheme` model and CSS custom properties.

Create at least:

```text
CorporateLight
CorporateDark
MinimalLight
```

### Acceptance Criteria

- At least three base themes.
- Application can switch theme by model value.
- No component has hardcoded business-specific styling.
- Customer customisation uses tokens, not custom components.

---

## Phase 6 — ADL Parser

### Goal

Add textual ADL syntax after the model and runtime work.

### Tasks

1. Create lexer.
2. Create parser.
3. Produce AST.
4. Convert AST to partial application model.
5. Resolve to full model.
6. Validate.

Initial grammar should be small.

Start with:

```text
APP
OBJECT
FIELD
LIFECYCLE
STATE
ACTION
VIEW
POLICY
THEME
SYNC
END.*
```

Do not add procedural keywords.

### Initial Example

```adl
APP Demo
  THEME CorporateLight
  START_VIEW UserList
END.APP

OBJECT User
  KEY Email
  DISPLAY Name

  FIELD Name TEXT REQUIRED
  FIELD Email TEXT REQUIRED
  FIELD Phone TEXT
  FIELD Active BOOL DEFAULT(TRUE)
  FIELD State TEXT DEFAULT('Draft')

  LIFECYCLE UserLifecycle FIELD State
    STATE Draft
    STATE Active
    STATE Suspended

    ACTION activate FROM Draft TO Active
      ALLOW ROLE Admin
    END.ACTION

    ACTION suspend FROM Active TO Suspended
      ALLOW ROLE Admin
    END.ACTION
  END.LIFECYCLE

  VIEW UserList LIST
    FIELDS Name Email Active
    SEARCH Name Email
    ACTIONS New Search
  END.VIEW

  VIEW UserEdit FORM
    FIELDS Name Email Phone Active
    ACTIONS Save Cancel
  END.VIEW
END.OBJECT
```

### Acceptance Criteria

- Example ADL parses.
- Parser errors are useful.
- Parsed ADL resolves to the same model shape used by the runtime.
- No generated Dart/Elixir application code is produced.

---

## Phase 7 — Policy Engine Hardening

### Goal

Make row, field, state and action control first-class.

### Required Behaviour

- Deny by default.
- Explicit deny wins.
- Field policy can restrict row policy.
- Lifecycle action policy controls whether action button appears and whether runtime/API transition is allowed.
- Same policy engine must be used by UI and runtime.
- Decision reasons must be returned.

### Acceptance Criteria

- Tests prove UI cannot bypass policy.
- Runtime update blocks unauthorised field changes even if UI tries.
- Search/list output masks fields according to policy.
- Lifecycle transition blocked if policy denies it.
- Decision explanations are testable.

---

## Phase 8 — Lifecycle Engine Hardening

### Goal

Treat business state transitions as first-class runtime operations.

### Tasks

Implement:

```ts
transition(objectName, recordId, actionName, context)
```

This must:

```text
load record
determine current state
find action
validate from-state
evaluate policy
run validation
run registered before hooks
apply state change
persist
write audit event
write operation log entry if local-first
run registered after hooks
emit event
```

### Acceptance Criteria

- Draft → Active works if allowed.
- Active → Suspended works if allowed.
- Invalid transition is rejected.
- Unauthorised transition is rejected.
- Audit event records old state, new state, user and action.
- Operation log records transition as transition, not simple update.

---

## Phase 9 — Storage Upgrade

### Goal

Replace in-memory store with browser local persistence.

### Recommended Path

1. In-memory store.
2. IndexedDB store if quickest.
3. SQLite WASM + OPFS once runtime shape is stable.

Create storage abstraction:

```ts
export interface ObjectStore {
  create(...): Promise<RecordId>;
  read(...): Promise<Record | null>;
  update(...): Promise<void>;
  delete(...): Promise<void>;
  search(...): Promise<Record[]>;
}
```

Do not let runtime services know whether storage is memory, IndexedDB, SQLite, or remote.

### Acceptance Criteria

- Storage is swappable.
- Tests can use in-memory storage.
- Browser demo can persist reloads.
- Indexed fields/search fields are honoured.
- Tombstones are supported instead of physical deletion for shared objects.

---

## Phase 10 — Sync Policy Design

### Goal

Make offline-first a runtime capability but not blindly applied to every object.

### Tasks

Implement model support for:

```text
LOCAL_FIRST
CACHE_READONLY
ONLINE_REQUIRED
LOCAL_PRIVATE
```

Implement runtime behaviour:

```text
LOCAL_FIRST:
  allow local writes and record operations

CACHE_READONLY:
  allow reads from local cache; block local writes

ONLINE_REQUIRED:
  block local offline operation

LOCAL_PRIVATE:
  allow local writes; never add to sync queue
```

### Acceptance Criteria

- Model supports sync policies.
- Runtime refuses local writes for online-only objects.
- Runtime records local-first operations in operation log.
- UI can show offline/read-only state.
- Full server sync is deferred until local runtime is stable.

---

## Phase 11 — Model Versioning and Basic Migration Guard

### Goal

Prevent persisted local data becoming ambiguous as object definitions evolve.

### Tasks

- Store object schemaVersion with records.
- Store application modelVersion.
- On runtime start, check persisted records against current model.
- If incompatible, produce a clear diagnostic.
- Do not implement full migrations yet.

### Acceptance Criteria

- Runtime can detect incompatible record schemaVersion.
- Runtime produces structured diagnostic.
- Compatible records open normally.

---

# 18. Concrete MVP Definition

Do not boil the ocean.

The ADL MVP is complete when it can run this end-to-end:

```text
One browser application
Two objects: User and PurchaseOrder
List/search/edit/create/delete
Lifecycle transition on PurchaseOrder
Row and field policy by state/role
Theme tokens
Local persistence
Audit log
Operation log
ADL text file parsed into resolved model
```

## MVP Objects

### User

```text
Name
Email
Phone
Active
State
```

### PurchaseOrder

```text
PONumber
Supplier
Value
Status
InternalNotes
ApprovalComment
```

Lifecycle:

```text
Draft → Submitted → Approved → Cancelled
```

Policies:

```text
Requester can create Draft
Requester can edit Draft fields
Approver can read Submitted
Approver can approve Submitted
InternalNotes visible only to Buyer/Admin
Approved records readonly
Admin can read all
```

## MVP completion checklist

The MVP should not be considered complete until these are all true:

```text
1. ADL text parses into AST.
2. AST converts into partial model.
3. Partial model resolves into explicit model.
4. Model validates with structured diagnostics.
5. Browser runtime renders list and form views from the model.
6. Runtime can create, search, update and delete records.
7. Runtime can perform lifecycle transition through LifecycleEngine.
8. Same PolicyEngine controls both UI visibility and runtime enforcement.
9. Field-level policy can make a field hidden, masked or readonly by state and role.
10. Audit records are created for create/update/delete/transition.
11. Local persistence survives page reload.
12. Operation log records local create/update/delete/transition operations.
13. Object sync policy exists in the model, even if full sync is deferred.
14. There is no Dart/Flutter or LiveView application emitter in the main path.
```

The MVP does not need to implement multi-context applications. It must, however, avoid design decisions that would make business contexts, context-scoped roles, or cross-context read models impossible to add cleanly.

---

# 19. Non-Goals for MVP

Do not implement initially:

```text
Dart emitter
LiveView emitter
general procedural modules
offline sync server
multi-tenant server
LLM generation
full LSP
workflow timers
email sending
attachments
reports
custom widgets
specialised calendar UI beyond normal date/datetime field inputs
SQL escape hatches
PostgreSQL-specific schema generation
external API integrations
Cedar/Rego/Casbin integration
full migrations
```

These can come later if the core runtime works.

---

# 20. How to Use Existing MINIL Code

## Reuse if clean

```text
name conversion functions
diagnostic structures
lexer/parser patterns
type system ideas
validation vocabulary
examples
test scenarios
workflow examples
schema examples
```

## Quarantine or discard

```text
Dart emitter
Elixir/LiveView emitter
generated UI code
transpiler build pipeline
old DART.INLINE support
old SQL.INTO support
procedural MODULE executor
```

## Possible importer later

Later, create:

```text
old MINIL subset importer
```

It should convert declarative parts only:

```text
SCHEMA → OBJECT/FIELD
PANEL → VIEW
WORKFLOW → LIFECYCLE
ACCESS → POLICY
AUTH → ROLE/POLICY seed
```

It should not try to convert arbitrary procedural MODULE code.

---

# 21. Development Rules for Codex

## General

- Work in small commits or small coherent changes.
- Keep the runtime model separate from parser syntax.
- Add tests for each runtime service.
- Prefer simple deterministic code over clever abstractions.
- Do not reintroduce transpiler output as the main architecture.
- Make defaults explicit and inspectable.
- Deny by default for security.
- Use British English in user-facing documentation/comments where natural.

## Logging and Debugging

For public runtime methods, include debug logging at entry and exit.

Example:

```ts
logger.debug("ENTER LifecycleEngine.transition", { objectName, recordId, actionName, context });
...
logger.debug("EXIT LifecycleEngine.transition", { result });
```

For storage/API calls, log before and after:

```ts
logger.debug("STORE BEFORE update", { objectName, recordId, patch });
logger.debug("STORE AFTER update", { objectName, recordId });
```

Do not log secrets, passwords, tokens, or sensitive field values unless explicitly configured for development.

## Error Handling

Use typed errors:

```ts
ValidationError
PolicyDeniedError
LifecycleError
ModelValidationError
StorageError
SyncPolicyError
SchemaVersionError
```

Do not rely on unstructured string exceptions.

## Testing

Every core service needs tests:

```text
model resolution
model validation
policy decisions
field validation
CRUD
lifecycle transitions
audit
operation log
theme token resolution
parser
schema version checks
```

---

# 22. Suggested First Codex Prompts

Use these prompts one at a time.

## Prompt 1

```text
In /home/vince/projects/personal/adl, build the revised Application Definition Language runtime as a standalone codebase. Inspect /home/vince/projects/personal/minil only as a reference repository and do not modify it. Create NOTES_FROM_MINIL.md summarising reusable concepts, reusable code, discarded parts, and risks. Also create docs/adr/0001-runtime-model-not-transpiler.md and docs/adr/0002-resolved-model-is-stable-contract.md. The new ADL architecture must not generate Dart/Flutter or Elixir/LiveView application code as its primary output. Its primary output is a resolved model consumed by a runtime.
```

## Prompt 2

```text
Inside /home/vince/projects/personal/adl, create a TypeScript project with package.json, tsconfig.json, vitest, and src/model/resolved-model.ts. Define the initial ResolvedApplicationModel interfaces for app, object, field, validator, lookup, lifecycle, lifecycle action, policy, view, theme, sync policy, record metadata and local operation log. Add tests that compile and import these types.
```

## Prompt 3

```text
Implement src/model/defaults.ts and src/compiler/resolve-model.ts. Given a partial application model, produce a fully explicit resolved model. Add deterministic defaults for table names, storage names, _guid identity, platform metadata, default views, default sync mode, and default deny policy. Add vitest tests proving default resolution is deterministic and inspectable.
```

## Prompt 4

```text
Implement src/compiler/validate-model.ts with structured diagnostics. Validate unique object names, unique fields, field references, lifecycle references, policy references, view references, autoId rules, lookup target references, sync modes, theme references and hook reference syntax. Return all diagnostics instead of throwing on the first error. Add tests for invalid models.
```

## Prompt 5

```text
Implement the first runtime services over an in-memory object store: ValidationEngine, PolicyEngine, AuditService, OperationLog, HookRegistry, ObjectStore, LifecycleEngine, and ApplicationRuntime. Support create/read/update/delete/search/transition for a User object and a PurchaseOrder object. Add tests for CRUD, policy denial, lifecycle transition, audit events and operation log entries.
```

## Prompt 6

```text
Create a minimal browser demo using Web Components or Lit that loads a hardcoded resolved ADL model and renders list and form views for User and PurchaseOrder. It must support search, create, edit, save, delete and lifecycle actions. Use the same runtime PolicyEngine for UI visibility and save enforcement.
```

## Prompt 7

```text
Add the initial ADL parser for APP, OBJECT, FIELD, LIFECYCLE, STATE, ACTION, VIEW, POLICY, SYNC and THEME. The parser should produce an AST, convert to partial model, resolve it, and validate it. Add examples/user.adl and examples/purchase-order.adl and tests proving they parse into the same resolved model used by the runtime.
```

## Prompt 8

```text
Add local persistence behind the ObjectStore abstraction. Start with IndexedDB if quickest. Persist records, metadata, audit events and operation log entries. Ensure records include schemaVersion and tombstone fields. Add tests or browser demo steps proving data survives reload.
```

---

# 23. Final Architectural Principle

ADL should feel like this:

```text
Define the business object.
Define the business contexts and scopes.
Define its lifecycle.
Define who can do what in each state.
Define the standard views.
Let the runtime do the boring work.
Override only when genuinely necessary.
```

The runtime owns:

```text
CRUD
validation
search
forms
navigation
context resolution
audit
policy
state transitions
API consistency
sync behaviour
backend enforcement
theme rendering
```

The developer owns:

```text
business meaning
fields
contexts
scopes
states
actions
rules
policy
read model intent
exceptional hooks
```

That is the corrected version of MINIL.
