# Claude Review — ADL Aim, Language, Runtime Philosophy, and Runtime Options

Date: 2026-07-16
Reviewer: Claude (Opus 4.8)
Scope: the whole repository plus the three new design docs added today
(`docs/ADL_Implementation_and_Marketing_Proposal.md`, `auth-options.md`,
`automerge-sync-architecture.md`).

This is an opinionated review, not a summary. Where I think something is
wrong or premature I say so.

---

## 0. What actually exists (so the review is grounded)

Before opinions, the facts I verified:

- ~14.5k lines of TypeScript. The runtime is real, not a sketch:
  `resolve-model.ts` (745), `validate-model.ts` (2360), `policy-engine.ts`,
  `lifecycle-engine`, `object-store.ts` (724), `context-service`,
  `read-model-service`, `offline-dataset-service` (626),
  `indexeddb-object-storage`, `command-service`, and an `application-runtime`
  that ties them together.
- A hand-written lexer + recursive-descent parser (1600 lines) that compiles
  the two `examples/*.adl` files into the **same** resolved model the runtime
  consumes.
- 87 passing tests across 8 files; 18 phases executed and committed.
- A model-driven band-management reference app that exercises business
  contexts, context-scoped roles, cross-context read models, and the four sync
  modes — with no Flutter, no Postgres, no server.

That matters for everything below: this is not a greenfield idea. The core bet
in the Codex brief — *resolved model first, runtime is the product* — has been
built and it works. Any pivot is now a pivot **away from a working thing**, and
must justify itself against that.

---

## 1. The aim

**Verdict: the aim is sound and the positioning is unusually disciplined.**

"Define applications instead of programming them", competing with Power Apps /
OutSystems / Mendix / ServiceNow / Retool rather than with browsers, is the
right frame. The marketing section's "do NOT sell" list (not a replacement for
HTML/JS/the W3C stack/an OS) shows rare restraint — those messages are exactly
the ones that have killed ambitious platform projects by inviting the wrong
comparison.

Where I'd push:

- **The real wedge is under-stated.** The proposal's differentiator list
  (faster delivery, offline, native perf, one definition, governance) is a list
  every competitor also claims. The genuinely defensible difference is that ADL
  is a **readable text definition under version control that compiles to an
  inspectable resolved model.** OutSystems and Mendix are proprietary,
  visual-first, and effectively un-diffable; you cannot code-review a Mendix
  change in a pull request. ADL can. "Your whole application is a file you can
  review, diff, and reason about, and the defaults are never invisible"
  (Boundary 7 — the explainable resolved model) is the thing none of the named
  competitors can honestly say. Lead with that, not with "native performance",
  which is the weakest and most contestable claim on the list.

- **Deterministic + local-first + governed is a niche, and that is fine.** This
  is a regulated-back-office / field-operations / multi-tenant-B2B tool, not a
  consumer app builder. The band app is a charming test fixture but it is not
  the market; procurement, care-ops, work orders, inspections are. Keep the
  reference app for exercising the runtime, but don't let it define the pitch.

- **"For BAs and devs" needs honesty about the seam.** Objects, fields, views,
  lifecycles, states, actions — genuinely BA-approachable. Policy blocks with
  deny-wins precedence, read models, sync conflict modes, context scopes — that
  is developer territory. The honest story is a *spectrum*: BAs draft the shape,
  developers own the policy and the projections. Selling it as "BAs write the
  whole app" would set up the same disappointment that has dogged low-code for
  twenty years.

---

## 2. The language specification

**Verdict: the model behind the language is excellent; the surface syntax is
good-but-verbose; the biggest gap is an expression language.**

### What's strong

- **Three-way identity** — immutable system `_guid`, business key, display
  field — is correct and is the thing most low-code tools get wrong. Aligning it
  with `sys_id` / Salesforce Id / Dataverse row ID is exactly right.
- **Lifecycle as a first-class property of an object**, with actions as
  policy-guarded transitions rather than procedural mutations, is the correct
  reframing of MINIL's workflow module. The example
  `ACTION approve FROM Submitted TO Approved ALLOW ROLE Approver` reads well and
  carries real semantics.
- **The policy grammar is the crown jewel.** `can(principal, action, object,
  row, field?, state, context) -> allow | deny | readonly | mask | hidden` is
  more expressive than the RBAC in any of the named competitors, and the
  evaluation rules (deny-by-default, explicit-deny-wins, field policy can
  restrict but not expand row policy, mask/hidden/readonly as data-shaping not
  errors) are mature. This is the part I would protect most fiercely from
  dilution.
- **Sync as an object-level policy** (`LOCAL_FIRST` / `CACHE_READONLY` /
  `ONLINE_REQUIRED` / `LOCAL_PRIVATE`) rather than a global database decision is
  a genuinely good idea and rare in this space.

### What concerns me

- **There is no expression language yet, and that is the real ceiling.** The new
  proposal's own "business logic" section asks for arithmetic, decimal money,
  comparisons, boolean logic, pattern matching, decision tables, and
  validations. Today ADL has named validators and simple field-equality
  conditions (`Availability.User == runtime.userId`) and nothing more. Real
  business apps live or die on *computed fields, cross-field validation, derived
  totals, and money math* (line-item sum, tax, "approval required when Value >
  10000"). Until ADL has a small, safe, deterministic expression sublanguage —
  decision tables and pure expressions, no loops, no side effects — it can model
  the *shape* of business apps but not their *rules*. I would prioritise this
  over almost anything else on the roadmap. It is also the thing that most needs
  designing carefully once (see the Wasm discussion below), because it is the
  one part of "business logic" that isn't already declarative.

- **The syntax is verbose and carries an RPG/COBOL accent** (uppercase keywords,
  `END.OBJECT`, `AUTO_ID PREFIX('PO-') PAD(6)`). That's a direct MINIL
  inheritance. It is *readable*, which matters more than terse, and the explicit
  block terminators genuinely help parser recovery and error messages. But be
  deliberate: this accent signals "enterprise/legacy" to developers and
  "code" to BAs. It is a defensible choice — I would keep it — but make it a
  choice, not an accident of heritage.

- **Policy verbosity will bite at scale.** The `PurchaseOrderPolicy` block is
  already dense for a four-state object. A real object with 8 states × 6 roles ×
  field-level rules becomes a wall of `ALLOW`/`DENY`/`READONLY` lines. Consider
  policy *composition/inheritance* and role-group defaults before customers
  write their tenth object, or the governance selling point becomes a
  maintenance liability.

- **Right call: deferring final syntax.** The brief's instinct — resolved model
  first, syntax last, "do not over-invest in final syntax until the resolved
  model is defined" — has been vindicated. The language is the least risky part
  precisely because it was treated as a compile target for a stable model rather
  than the foundation.

---

## 3. The runtime philosophy

**Verdict: this is the strongest part of the whole project, and it is what
makes the new proposal survivable.**

Two decisions carry the entire architecture and both are right:

1. **Runtime-model-first, not transpiler** (ADR 0001). "Improve the runtime once
   and every application benefits" is the correct inversion of MINIL's
   regenerate-thousands-of-lines model. This is the single best decision here.

2. **The resolved model is the stable contract** (ADR 0002). Every authoring
   input (ADL text, JSON/YAML fixtures, future importers, future visual
   designers, AI generation) converges on one versioned `ResolvedApplicationModel`
   that the runtime consumes. Nothing downstream touches the AST.

The maturity of the surrounding choices reinforces it:

- **The browser is not trusted** (Boundary 5) — local checks are UX; the server
  re-checks everything. Most local-first demos get this wrong; ADL wrote it into
  the constitution.
- **Operation-log / intent-based sync**, not row-diff sync. Syncing
  "approve PO123 from revision 8" instead of "set status = Approved", so the
  server can reject a stale transition, is sophisticated and correct. It is also
  the thing that makes offline lifecycle transitions actually safe.
- **Explainable defaults** (Boundary 7) — `source + platform defaults +
  inherited + overrides = resolved model`, inspectable. This is both a debugging
  feature and, per §1, the real product differentiator.

The one philosophical caution: **the runtime is now the entire surface area of
the product.** Every capability an app needs that the language cannot express
must be added to the runtime, in every runtime you ship. That is fine with one
runtime. It becomes the central risk the moment you contemplate a *second*
runtime — which is exactly what the new proposal does.

---

## 4. The runtime options (this is where the new proposal needs scrutiny)

The new proposal keeps the language and pivots the implementation to: **Dart
runtime, Flutter UI, SQLite, business logic compiled to WebAssembly, invoked
through a Rust/Wasmtime bridge over a C ABI, packaged as `.adlpkg`, eventually a
dedicated appliance.**

Set against what's built (TypeScript runtime, Web/PWA, Web Components, IndexedDB
→ SQLite-WASM/OPFS), this is a much bigger pivot than "implementation, not
language" makes it sound. My honest assessment:

### 4.1 What the proposal gets right

- **The stable-model contract means the renderer and host *can* be swapped.**
  Because UI is rendered from the resolved model and nothing depends on the AST,
  a Flutter renderer really is "just another renderer." The architecture was
  built for exactly this substitution. Credit where due: this is the pivot the
  system was designed to survive.
- **Flutter genuinely buys native desktop + mobile from one UI tree**, which the
  PWA path gives you only partially (iOS PWA remains a second-class citizen).
  The "one application package on Windows/macOS/Linux/Android/iOS/Web/appliance"
  vision is more credible on Flutter than on a PWA.
- **SQLite as the primary local store is the right endpoint** — the brief
  already names SQLite-WASM/OPFS as the destination. No disagreement.
- **The appliance / Tiny Core Linux idea is a legitimate long-game** for the
  regulated/offline market, and correctly placed at Stage 4.

### 4.2 Where I think it is wrong, or at least premature

- **"Implementation detail" undersells a full runtime rewrite.** Moving to Dart
  does not swap a detail — it re-implements ~12k lines of working, tested
  TypeScript runtime (policy, lifecycle, validation, object store, context, read
  models, offline datasets, operation log) in a second language. The *model* is
  preserved; the *runtime* is not. That is a rebuild, and the proposal's Stage 1
  ("reference execution in Dart") quietly discards a reference execution you
  **already have in TypeScript**. The cheapest correct sequencing is: the
  existing TS runtime *is* your Phase-1 reference semantics. Don't re-earn that.

- **The Wasm layer is the part I'd challenge hardest.** The proposal compiles
  business logic to Wasm and routes it through `Dart → dart:ffi → C ABI → Rust →
  Wasmtime`. That is a large, high-maintenance bridge. Ask what it actually buys:
  - *Performance?* Declarative rules (decision tables, event→command,
    validations) over SQLite are not compute-bound. A table-driven interpreter
    of the resolved-model expression AST will be indistinguishable from Wasm for
    these workloads, at a fraction of the complexity. Wasm is a solution to a
    performance problem this workload doesn't have.
  - *Client/server determinism parity?* This is the *only* strong argument —
    running byte-identical logic on client and server (Stage 3's "shared
    execution"). But you get the same guarantee far more cheaply by interpreting
    the **same resolved-model expression AST** on both sides. Determinism comes
    from the expression language being pure and total, not from the compilation
    target.
  - *Sandboxing untrusted customer logic?* A real future reason — but only once
    you allow customers to ship arbitrary logic, which the whole "avoid arbitrary
    scripting / declarative only" philosophy says you won't.

  So: **design the pure expression sublanguage now (§2); defer Wasm until a
  concrete parity or sandboxing requirement forces it.** Adopting
  Rust+Wasmtime+FFI before there is an expression language to compile is
  building the printing press before the alphabet.

- **Flutter is the stack the brief deliberately fled.** §14 of the brief lists
  "Do not introduce React, Vue, Angular, **Flutter**, LiveView." MINIL's pain was
  Dart/Flutter generation. Re-adopting Dart/Flutter — even as a renderer rather
  than a generation target — walks back toward that world. It may still be the
  right call for native reach, but it should be made with eyes open, not filed
  under "implementation detail."

- **The stack is sprawling across three design docs.** Today's docs point at
  three different technology centres: this proposal wants a **Dart** runtime;
  `automerge-sync-architecture.md` wants **Go + Postgres + Automerge** on the
  server; `auth-options.md` recommends a **TypeScript-first** auth service
  (Better Auth). That is Dart + Rust + Go + TypeScript + SQL before the first
  paying customer. Each doc is individually reasonable; together they need
  reconciling, or you will maintain four language ecosystems to ship one product.

### 4.3 What I would actually do

- **Keep the TypeScript runtime as the reference implementation and ship the
  product on it (PWA).** It exists, it is tested, and it proves the model with
  real users fastest. The whole point of the runtime-is-the-product bet is that
  you can defer everything else.
- **Design the pure expression / decision-table sublanguage next.** It is the
  biggest genuine gap and it is the thing every later runtime must implement
  identically — so nail its semantics once, in the reference runtime, with a
  conformance test suite.
- **Treat that conformance test suite as the real contract.** When/if a Dart or
  Wasm runtime is built, it earns the right to exist by passing the same suite.
  That is how "one definition, consistent behaviour" stops being a slogan.
- **Gate the Flutter/Dart/Wasm/appliance work on demonstrated demand** for native
  packaging or offline appliances — i.e. its own roadmap's Stage 3–4 — not now.
  The proposal's roadmap already sequences it correctly; the risk is the
  *narrative* ("pivot the implementation") pulling the work forward before the
  product is proven.
- **Reconcile the three stack docs into one target architecture** before
  committing engineering to any of them.

---

## 5. Bottom line

- **Aim:** right market, disciplined positioning; lead with "your app is a
  reviewable, diffable, inspectable definition" rather than "native performance."
- **Language:** the underlying model (identity, lifecycle, policy, sync-as-policy)
  is genuinely strong; the surface syntax is fine; the missing pure-expression /
  decision-table sublanguage is the top priority.
- **Runtime philosophy:** the best part of the project. Runtime-model-first and
  resolved-model-as-contract are correct, mature, and already paying off — they
  are what make a renderer/host pivot even possible.
- **Runtime options:** the Flutter/native reach is a legitimate long-term goal
  and the architecture can accommodate it. But the Dart rewrite is a rebuild not
  a detail, the Wasm/Rust/Wasmtime bridge is premature until an expression
  language and a parity/sandboxing requirement exist, and the three current
  design docs point at three different stacks that need reconciling. Ship on the
  TypeScript runtime, harden the expression semantics and a conformance suite,
  and let any second runtime earn its place by passing that suite.

The strongest sentence in the whole proposal is its own conclusion: *the runtime
is enabling technology; ADL itself is the product.* Every recommendation above is
just that sentence taken seriously — which means not letting a runtime rewrite
become the thing that delays the product.
