# Retention Scheduling and the Administration UI

Read this before changing retention windows, the retention runner, scheduler or
CLI entry point; before adding an operator-triggerable action of any kind; or
before changing the browser administration and reporting surfaces.

Phase 55 gave the Phase 45 prune a way to actually run, and gave the Phase 43
administration and reporting endpoints a browser surface. It builds on
[[authority-transaction-integrity]] for the commit boundary and
[[membership-projection]] for the advisory-lock pattern.

## Retention has no HTTP trigger, and that is the design

The obvious shape — a `/v1/admin/retention/run` route next to the other
`/v1/admin/*` routes — is wrong here, and the reason generalises.

**Retention is application-wide. Every administration authorisation in this
repository is context-scoped.** `requireAdministration` gates each admin call on
the caller passing membership-management policy in *one* selected business
context. A trigger under that gate would let a context manager start a
destructive delete covering every other context's audit and outcome rows — a
capability their membership does not confer.

There is no fix that keeps the route:

- Scoping the prune to one context would not be retention. The projections that
  grow are not all context-scoped, and a per-context prune would leave the
  unscoped rows growing forever.
- Gating it on some "operator" role would be a second policy implementation
  living in the server, since the model declares no such role.

So the route that exists is `/v1/admin/retention/status`, a read with no run, no
dry-run and no cutoff argument. Running retention belongs to whoever can start a
process, not to whoever holds a session.

**The general rule to carry forward: before exposing an action, check whether its
blast radius matches the scope of the authorisation that would gate it.** If the
action is wider than the scope, the answer is not a narrower action — it is no
route.

## The advisory-lock pattern, and how to prove it

`AuthorityRetentionRunner` takes
`pg_advisory_lock(hashtext('adl_authority_retention:<applicationId>'))` for the
duration of a run and releases it in a `finally`. This is the same pattern Phase
54 used for startup, and the same details matter:

- Key it per application with `hashtext`, so unrelated applications sharing one
  database never serialise against each other.
- Take it on a **pinned client** from the pool, not on the pool, or the unlock
  can land on a different backend from the lock.
- Only unlock what was actually taken; releasing an unheld session-level lock
  logs a PostgreSQL warning.
- A contender **waits** rather than skipping. That is what makes a cron
  invocation and an in-process schedule safe together: the second run proceeds
  once the first has committed and finds nothing left to do.
- A crashed process releases the lock when its backend ends, so it can never be
  held by nobody.

**Proving mutual exclusion needs care, and the obvious test proves nothing.**
Retention is idempotent, so two concurrent runs agree whether or not the lock
exists — a test that starts two runs and asserts the result is correct passes
with the lock deleted. The deterministic proof is the one Phase 54 established:
take the same advisory lock on a separate client, start a run, assert it has
**not** settled after a generous wait, release, then assert it completes. That
fails immediately if the lock is removed.

## The per-projection guards, and why they are floors

Each prunable projection has its own predicate, chosen from a fixed table in
`authority-retention.ts` — never anything derived from a request — with the
application id and the cutoff as bound parameters.

The cutoff itself is clamped per projection to no later than `now - window`. This
is the property that matters: an operator (or a future caller) asking for a more
recent cutoff cannot reach an in-retention row, because the clamp is a floor
rather than a preference.

The session and challenge guards are the non-obvious part:

```sql
least(coalesce(revoked_at, expires_at), expires_at) < $cutoff
```

Read it as "whichever ending came first". For a session that is neither revoked
nor expired, `revoked_at` is null, so the expression collapses to `expires_at` —
a future instant — while the cutoff is always in the past. **An active session is
therefore structurally unreachable by this SQL, not merely filtered out by it**,
and the same shape (`consumed_at`, `expires_at`) makes an answerable challenge
unreachable. That distinction is the whole safety argument: pruning a live
session would sign somebody out mid-grace with no way to tell them why, and no
amount of window configuration can produce it.

The expression is not covered by the Phase 42 retention index — it indexes the
columns, not the expression — which is why `0009_retention_scheduling.sql` adds a
partial index over already-revoked sessions and a challenge index.

## `adl_authority_context_memberships` must never be pruned

It is absent from `AUTHORITY_RETENTION_PROJECTIONS` deliberately, and the comment
there says so. Two independent reasons:

1. It is **bounded by the record set**, not by time — one row per accepted
   membership record, live or tombstoned — so it does not grow the way the four
   prunable projections do and has nothing to prune.
2. It is **derived from accepted records**, and Phase 45's rule that retention
   never touches accepted state extends to it. Deleting a row would remove a live
   membership from resolution without removing the membership: access loss with
   no record change behind it and no audit trail.

The integration suite has a case that prunes every prunable projection and then
asserts the membership projection is untouched. Keep it. Adding a fifth
projection to the prunable list is exactly the change that would quietly break
this.

## The run log self-trims, or it becomes a fifth unbounded projection

`adl_authority_retention_runs` exists to prove retention happened. If it grew
without bound it would need retention itself, which is absurd, so
`PostgresAuthorityRetentionRunStore.record` deletes everything outside the most
recent `AUTHORITY_RETENTION_RUN_HISTORY` (200) rows **for that application**, in
the same transaction as the run it just wrote. The trim is application-scoped;
there is a test asserting one application's trim leaves another's history alone.

The table is metadata-only by construction rather than by convention: no column
could hold an accepted record, an audit payload, a token, a verifier or an
outcome body. `failure_code` is a reduced fault name (`Error 42P01`), never a
driver message — driver messages can name hosts, roles and statement text.

A failed run is recorded after the rollback, on the same pinned client. The one
case where it is not is a failure whose cause is that the application id is
unknown to the database: the foreign key then refuses the row, so the structured
log is the only report. The write is wrapped in a `catch` that swallows — the run
already failed, and failing to record a failure must not replace the failure.

## The retention CLI reads a deliberately small environment

`loadRetentionProcessConfiguration` reads `ADL_APPLICATION_ID`,
`ADL_DATABASE_URL` and the four retention variables. It does **not** load
`AuthorityConfiguration`.

That is deliberate and worth defending if someone tries to unify them: a
retention job needs no allowed origins, no identity verifier, no relying party
and no cookie policy. Requiring the full configuration would make the safest way
to run retention (a scheduled process, out of band, with no HTTP surface) the
most awkward one to configure, and awkward configuration is how an operator ends
up not running it at all.

Two smaller conventions in the same file: the application id gets the same shape
check the authority process applies, because it is the key every projection row
hangs off and real PostgreSQL rejects control characters in it; and the exit code
is the contract with the scheduler — 0 for completed, dry or held, 1 for failure
— so a cron wrapper can alert without parsing text. A legal hold exits 0 because
it is a policy state, not a fault.

`ADL_RETENTION_INTERVAL_MINUTES` being **absent by default** is what makes the
whole thing safe to ship: a deployment that has not thought about retention
deletes nothing.

## The administration UI adds no authority

Every read goes through an endpoint that already existed and already enforced its
own boundary. The components make no network call themselves, hold no operational
credential, and take no authorisation decision; they render what the bridge gives
them and dispatch intent upward.

The consequence that looks wrong at first: **the administration chrome renders
for any signed-in caller**, not only for one the shell believes is an
administrator. That is intentional. Hiding it based on a role the browser
believes it knows would be the browser deciding scope, which is the thing the
constraint forbids. A caller who may administer nothing sees empty lists.

**Denial must stay indistinguishable from absence**, and this shapes the copy as
much as the code:

- Nothing anywhere says "you are not permitted".
- `unavailable` means *no context is selected to administer*, never that the
  caller lacks permission.
- The server answers an unknown or unauthorised read model with an empty report
  rather than an error, so the surface reports "no rows" in both cases and never
  becomes an oracle for which reports exist.
- Offering every declared read model as runnable is therefore safe: only the name
  is sent, and the authority resolves it, applies read policy and shapes the rows.

Two further rules that are easy to erode later: nothing is cached across contexts
and nothing is merged, because a stale page from one context under another
context's heading would be a disclosure the server never made; and no count,
total or aggregate is derived in the browser, because a locally derived number
can disclose more than the server returned.

## Authority chrome only gets screenshotted with its own Playwright project

The default visual projects run the reference app with **no authority
configured**, so no session, invite, recovery or administration chrome renders
there at all and a green visual run proves nothing about any of it. Phase 49 hit
this first and solved it with a dedicated `passkey` project; Phase 55 needed the
same shape and could not reuse that one, because a bypassed-identity deployment
and a passkey deployment cannot be the same process.

So `administration` is its own Playwright project with its own dev server on its
own port, its own `VITE_ADL_AUTHORITY_URL`, and its own throwaway authority
(`tests/visual/administration-authority.ts`). The harness wiring is deliberate,
not laziness:

- **In-memory stores**, because correctness against real PostgreSQL is proven in
  `tests/integration/`. What only a browser can prove is that the real
  components, bridge and HTTP edge produce a usable operator surface together;
  requiring Docker to take a screenshot would be the wrong trade.
- **An `https://` Request URL over a plain HTTP socket**, as the passkey harness
  does, because the edge refuses a non-HTTPS request and TLS terminates at a
  proxy in deployment.
- **The identity bypass and a seeded administrator**, so the spec is about
  administration rather than about identity.
- **A fixture retention status**, because retention itself is proven elsewhere
  and what the screenshot must show is that the surface presents it as read-only
  metadata with no way to trigger a run.

If you add another authority-chrome surface, expect to add a project rather than
to extend an existing one — see [[visual-browser-verification]].

## What the browser project found that nothing else could

Standing this project up was not ceremony. Five real defects were sitting in the
signed-in browser path, every one of them invisible to the unit suite and to the
integration suite, and the first two made the application dead on arrival for a
real user:

1. **A bootstrap with nothing selected returned nothing.** `AuthorityService`
   resolved its context from `selectedContexts` alone, so a device that had just
   signed in — which cannot have selected anything — got zero records, including
   the membership records that would have told it which contexts exist. A user
   signed in and had no context to choose, forever. `resolveBootstrapContext` now
   additionally resolves the caller's context roles for every declared membership
   context they did not select. This grants nothing: the roles come from the
   caller's own accepted membership records by the same `resolveContextRoles` a
   `CONTEXT ALL` view already uses, and every candidate still passes through
   `runtime.read` and its policy. **Replay deliberately keeps the narrow
   resolution** — a write must land in a context the client actually named.
2. **`adl-app`'s `context` getter returned the raw base context**, without the
   selection held in `selectedContextIds`. Every outside consumer — the sync
   bridge above all — was told nothing was selected, so bootstrap sent no
   selection and the administration surface could not tell which context it was
   meant to administer with one plainly chosen in the top bar. The getter now
   returns `baseRuntimeContext()`, the same shape the runtime is given.
3. **Available contexts were resolved only at `initialize()`.** They are a
   function of the accepted memberships this device holds *and* of who the app is
   running as, and both change after startup. `refreshFromRuntime` re-resolves
   them now, so signing in or claiming an invitation surfaces the new contexts
   without a reload.
4. **An empty-state that removed its own way out.** The review components
   rendered an explanation and no controls when no context was selected — so
   after selecting one there was no refresh button left to press. Keep the action
   that can leave a state *in* that state.
5. **A blob URL revoked in a `finally` after `click()`** cancels the download it
   just started; the CSV export appeared to do nothing at all. Revoke on a later
   turn.

The generalisable lesson: an end-to-end browser path has failure modes that no
amount of unit and integration coverage reaches, because each layer was correct
in isolation. If a phase adds a surface a person is supposed to *use*, drive it
in a real browser before believing it works.

The same run also showed the reference app declared no `EXPORT` rule on any
object, so CSV export — a Phase 43 capability — was unreachable in the only
application we have. Runtime capability and modelled permission are separate
things, and shipping the former without the latter leaves a feature that cannot
be demonstrated. See [[reference-app-models]].

## A counter nobody serves does not exist

`AuthorityMetrics` carries `adl_authority_retention_runs_total{outcome}` and
`adl_authority_retention_deleted_total{projection}`. Both `AuthorityHttpDependencies`
and `AuthorityRetentionRunnerOptions` default `metrics` to a fresh instance when
none is passed, and that default is a trap: `/metrics` is served by the HTTP
edge, so a runner counting into its own registry emits numbers nothing can ever
scrape. `createAuthorityProcess` now constructs **one** `AuthorityMetrics` and
**one** `StructuredSecurityLogger` and passes both to the runner and the edge.

Apply the same rule to anything else composed alongside the edge. A convenient
per-component default is right for a unit test and wrong for a composition root.

The one-shot CLI genuinely has no endpoint, and should not grow one — a cron job
opening a port to be scraped for the few seconds it lives is worse than the
alternative. Its evidence is the structured log line plus the row it commits to
`adl_authority_retention_runs`, which is why that table exists at all. Alert on
the *absence* of a completed run: a scheduled job that never fired emits nothing,
so a failure-only alert is silent in exactly the case that matters most.

See [[authority-transaction-integrity]], [[membership-projection]],
[[production-authority-operations]],
[[authoritative-reporting-and-administration]] and [[testing-expectations]].
