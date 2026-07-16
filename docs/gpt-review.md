# GPT Review

I did not read `claude-review.md`.

## Summary

ADL is aiming at the right problem: business applications are still mostly built by translating business concepts into general-purpose programming machinery, then maintaining the translation forever. The strongest idea in this repository is that ADL should make the business model, lifecycle, permissions, context, views, audit, and offline behaviour the primary artefacts, with a runtime doing the repetitive enforcement work.

The current repo is not just a language sketch. It already contains a substantial TypeScript reference implementation: resolved model, defaults, validator, parser subset, runtime services, policy engine, lifecycle engine, browser UI, IndexedDB storage, model version guard, context-scoped roles, read models, offline dataset evaluation, command transactions, constraints, and a band-management reference app.

My main view is:

- The aim is strong and commercially coherent.
- The runtime-model-first philosophy is the right foundation.
- The resolved model is currently more important and more mature than the authored ADL syntax.
- The new Dart/Flutter/SQLite/Wasm proposal is a plausible product-runtime direction, but it should be treated as a runtime implementation option, not as a reason to reset the language or abandon the TypeScript reference runtime too early.
- The next major risk is semantic sprawl: ADL can become powerful enough to express real apps, but only if the language remains business-facing and does not slowly turn into a procedural programming language with business keywords.

## The Aim

The aim is compelling: define applications in terms that business analysts and developers can both inspect.

The valuable centre is not "a simpler programming language". It is a shared business application contract:

- what objects exist
- what fields mean
- what states an object can be in
- what actions move it between states
- who can see or change what
- what context a record belongs to
- what views and read models exist
- what data should be local, cached, private, or online-only
- what the runtime must enforce everywhere

That is a better target than a generic low-code UI builder. It puts ADL closer to ServiceNow App Engine, Power Apps, Mendix, OutSystems, and internal enterprise platforms than to JavaScript, HTML, Flutter, SQL, or a general-purpose language.

The marketing proposal gets this right: do not sell ADL as a replacement for the web, JavaScript, or operating systems. Sell it as "define applications instead of programming boilerplate".

The important nuance is that BAs and developers probably should not use ADL in exactly the same way. BAs should be able to read, review, and author core business definitions. Developers will still own integrations, custom hooks, server authority, deployment, package management, migration review, and complex runtime extensions. That division is healthy.

## Language Specification

The current language direction is good: keyword-first, explicit blocks, business nouns, and no procedural centre.

The strongest constructs are:

- `APP`
- `ROLE`
- `OBJECT`
- `FIELD`
- `LIFECYCLE`
- `STATE`
- `ACTION`
- `VIEW`
- `POLICY`
- `THEME`
- `SYNC`

The examples are readable, especially for `User` and `PurchaseOrder`. The syntax has a useful "business system spec" feel rather than a programming-language feel.

The biggest issue is that the real platform model has moved beyond the textual ADL syntax. The resolved model already supports contexts, object scopes, context membership, read models, commands, policy conditions, uniqueness constraints, ordered constraints, sync scopes, and offline datasets. Not all of that appears to be exposed as first-class ADL syntax yet.

That is fine at this stage, but it creates a documentation and product risk: if ADL is the product, the authored language needs to catch up with the semantics that make the runtime interesting.

I would split the language docs into three explicit layers:

1. **Core ADL syntax**: the human-authored language.
2. **Canonical resolved model / IR**: the fully explicit contract after defaults and validation.
3. **Runtime semantics**: what policy, lifecycle, storage, sync, context, and UI services must do with that model.

Right now, those ideas exist, but they are spread across the implementation brief, phase files, learnings, examples, ADRs, and source. That is normal during build-out, but it is not yet a clean language specification.

The language should continue to avoid arbitrary scripting. The proposal's "deterministic event-to-command transformations" is the right direction. The expression layer should be deliberately small:

- comparisons
- boolean logic
- arithmetic
- decimal money
- field/runtime references
- decision tables
- validation predicates
- command preconditions

Avoiding arbitrary scripting is essential. Once ADL has loops, local variables, raw SQL, host-language inline code, and network effects in the language, it stops being a business definition language and becomes another application programming language.

## Runtime Philosophy

The runtime philosophy is the strongest part of the repo.

The key decisions are right:

- The runtime consumes the resolved model, not parser AST nodes.
- Defaults are explicit and inspectable.
- Policy is a runtime service, not UI behaviour.
- Lifecycle transitions are first-class operations, not field updates.
- The browser is not trusted.
- Offline-first is object-level policy, not a global assumption.
- Context-scoped roles are not global roles.
- Dataset membership is separate from authorization.
- The backend remains an implementation choice, not a language construct.

The implementation follows this philosophy better than many architecture docs do. The runtime services are separated in a sensible way: validation, policy, lifecycle, storage, audit, operation log, hooks, sync policy, context service, read model service, offline dataset service, and command service.

That service split is important because it makes ADL more than a UI generator. A UI generator can hide fields. ADL's runtime can deny the write, shape read output, reject invalid transitions, log audit events, and later require the server to re-check the same operation.

The policy engine is especially important. The decision shape and rules around deny-by-default, explicit deny precedence, field-level restrictions, masking, hidden fields, readonly fields, state checks, lifecycle actions, and context roles are exactly the kind of machinery that should be centralised.

The lifecycle engine is also well framed. Treating `approve` as "approve purchase order from revision N" rather than "set Status to Approved" is a major architectural distinction. That is the difference between a business operation and a CRUD patch.

## Runtime Options

The new proposal introduces a possible implementation pivot: Dart runtime, Flutter renderer, SQLite local store, future Wasm business-logic backend, Rust/Wasmtime bridge, and packaged `.adlpkg` applications.

I would not treat that as conflicting with the existing ADL language. I would treat it as a candidate product runtime.

### TypeScript / Browser Runtime

The current TypeScript browser runtime is the right reference runtime for now.

It is good for:

- iterating on the resolved model
- proving semantics with tests
- building developer tooling
- implementing parser/compiler work
- running a browser demo quickly
- inspecting defaults and diagnostics
- exercising policy/lifecycle/context/sync behaviour without native packaging overhead

It should remain the semantic reference until the language and resolved model settle further.

### Dart / Flutter Runtime

Dart and Flutter are plausible if the product priority becomes polished native-feeling desktop/mobile apps from one renderer.

The benefit is clear:

- strong mobile/desktop story
- good offline UI capability
- one renderer for several platforms
- SQLite integration is practical
- strong packaging story for native apps

The risk is equally clear: Flutter can quietly become the real product boundary. If that happens, ADL drifts back toward the MINIL problem, just with a runtime instead of generated Flutter code.

If you pivot to Dart/Flutter, I would make it a second runtime that must pass the same resolved-model conformance tests as the TypeScript runtime. Do not rewrite the language around Flutter concepts. The IR should still describe logical fields, views, policies, commands, and workflows, not Flutter widgets.

### SQLite

SQLite is a strong local store candidate, especially for serious offline apps, migrations, constraints, query performance, and native packaging.

IndexedDB is good enough for the current browser reference runtime. SQLite becomes more attractive when:

- local query complexity increases
- migrations become unavoidable
- read models need better indexing
- offline data volumes increase
- native desktop/mobile packaging becomes a near-term goal

The language should still not expose SQL as the normal authoring surface.

### Wasm / Rust

Wasm is a good long-term execution target for deterministic business logic, but I would not make it the next immediate centre of gravity.

The best future use is probably a small deterministic kernel:

- expression evaluation
- validation predicates
- decision tables
- policy conditions
- command preconditions
- maybe lifecycle guard evaluation

The runtime should still own storage, UI, networking, filesystem, sync, permissions, and platform services.

Wasm too early would add complexity before the semantics are stable. Wasm after the expression model is stable could give ADL a strong cross-runtime story.

### Automerge / Go / Postgres

The Automerge sync architecture note is pragmatic.

Automerge is useful for local-first change movement, incremental sync, reconnect behaviour, and conflict-preserving change history. It should not become the authoritative policy layer.

The safer model is:

- ADL runtime validates locally for fast feedback.
- Automerge moves intent or document changes.
- Go server validates identity, membership, policy, constraints, schema version, and command semantics.
- Postgres stores accepted authoritative projection, audit, recovery, constraints, and reporting.

That is consistent with the core philosophy: browser-local behaviour improves UX, but the server remains authoritative for shared enterprise data.

## My Recommended Pivot

I would not pivot the language. I would be cautious about pivoting the implementation too abruptly.

The clean path is:

1. Keep TypeScript as the reference semantic runtime.
2. Define the canonical resolved model / IR as a versioned, documented contract.
3. Build a conformance test suite for policy, lifecycle, validation, context, commands, read models, sync modes, and offline datasets.
4. Add an `adl inspect` or equivalent command that shows the fully resolved model and explains defaults.
5. Bring the authored ADL syntax up to the runtime model, especially contexts, read models, commands, constraints, and structured conditions.
6. Prototype a small Dart/Flutter runtime against the same resolved model and conformance tests.
7. Only then decide whether Dart/Flutter becomes the primary product runtime.

This preserves the work already done while giving the new proposal a fair path.

## Main Gaps

The biggest current gaps are not conceptual. They are productisation and specification gaps.

The project needs:

- a compact language reference separate from the implementation brief
- a resolved-model / IR reference
- a runtime semantics reference
- an explanation/inspection tool for defaults and policy decisions
- parser syntax for the advanced model features already implemented
- a clearer migration story
- a server authority story for auth, sync replay, conflict decisions, and invite workflows
- packaging story for `.adlpkg` or equivalent bundles
- conformance tests that any future runtime must pass

The band reference app is a good choice because it forces real problems: context roles, invitations, user-owned availability, cross-context dashboards, ordered set lists, offline datasets, and future sync authority. It is much better than proving the platform only with a todo app or CRM contact list.

## Final View

ADL is strongest when it is a business application contract plus a runtime enforcement platform.

The language should stay declarative and business-facing. The resolved model should remain the stable contract. The runtime should remain responsible for policy, lifecycle, validation, audit, context, storage, sync behaviour, and UI rendering.

The new proposal's Dart/Flutter/SQLite/Wasm direction is credible, but it should be layered underneath the language and IR, not allowed to redefine them. The product is not TypeScript, Dart, Flutter, SQLite, Wasm, or an appliance. The product is the ability to define a business application once, inspect exactly what it means, and run it consistently across runtimes.
