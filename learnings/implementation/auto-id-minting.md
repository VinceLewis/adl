# AUTO_ID Minting (Phase 74)

Read this before changing `AUTO_ID` field declarations, `ObjectStore.planCreateForTransaction`,
or anything that decides where a `CREATE` write gets its final field values from.

## What changed

`AUTO_ID` (a text field modifier: `AUTO_ID [PREFIX('...')] [PAD(n)] [SCOPE <field>]`)
went from declarative-only to actually minting a value. Phase 72 had refused an
`AUTO_ID` field with no `DEFAULT` (`ADL_AUTO_ID_NO_DEFAULT`) as a stopgap,
because nothing minted a value and the field would otherwise never receive
one. Phase 74 built the minting mechanism and removed that refusal — it is now
actively wrong, since it would refuse a perfectly legal, functional
declaration once minting exists. See
[[syntax-uniformity-and-behavioral-guardrails]] for the historical refusal
this superseded.

## Where minting happens, and why there

`ObjectStore.planCreateForTransaction` (`src/runtime/object-store.ts`) mints,
right after `ValidationEngine.prepareCreateValues` applies ordinary
`DEFAULT`s and before the record is built. This is the single choke point for
every create path in the runtime — direct `ObjectStore.create`/
`ApplicationRuntime.create`, a command's `CREATE` step
(`command-service.ts`), and the authority's own re-execution of an offline
command (`authority-service.ts`) — so minting cannot be bypassed by adding a
new caller; every caller of `planCreateForTransaction` gets it for free.

For each field with `field.autoId !== undefined`:

- If the caller's own `values` argument (not the defaulted `preparedValues`)
  already names the field, that value is used as-is and nothing is minted.
  This is deliberate, not an oversight: it is what lets an import or
  migration author the field directly, exactly like `_guid` lets an explicit
  `options.recordId` override a minted one. Checking the *original* argument
  rather than the post-default value matters — a plain `DEFAULT` on an
  `AUTO_ID` field (kept in `examples/purchase-order.adl` as a harmless
  historical placeholder) is not an explicit caller value, so minting still
  overrides it.
- Otherwise, the next sequence number is found by asking the storage backend
  for every record of the object (`this.storage.search({ object, fields: [],
  includeDeleted: true })` — `includeDeleted: true` so a deleted record's
  number is never handed out again), optionally narrowed to records sharing
  the new record's own `SCOPE` field value, reading each candidate's *own*
  value for the same field, stripping a leading `PREFIX` match and parsing
  the remainder as digits. A candidate whose value does not start with
  `PREFIX` or whose remainder is not entirely digits is a foreign or
  hand-entered value and is ignored rather than corrupting the count. The
  mint is one past the highest number found, or `1` if none qualify, then
  zero-padded to `PAD` digits (no padding if `PAD` is absent or `0`).

## Why a REQUIRED AUTO_ID field with no DEFAULT needed a validation-engine change too

This was the one real gap in the design as originally specified. Minting runs
*after* `ValidationEngine.prepareCreateValues`, but that same method's
`validateRecordValues` step throws `ADL_RUNTIME_FIELD_REQUIRED` for any
`REQUIRED` field with no value *before* `ObjectStore` ever gets a chance to
mint one — so a `REQUIRED AUTO_ID` field with no `DEFAULT` (the exact shape
`ADL_AUTO_ID_NO_DEFAULT` used to refuse, and the realistic default case for
something like a PO number or invoice number, which is normally required)
would compile clean and then still fail every create.

`validateRecordValues` gained an `isCreate: boolean` parameter (`true` only
from `prepareCreateValues`; `false` from `prepareUpdateValues` and
`prepareTransitionValues`) and treats a missing value as satisfiable — not
"missing" — when `isCreate && field.autoId !== undefined`. Update and
transition are deliberately **not** exempted: by the time either runs, the
field was already minted or explicitly supplied on create, so a value that is
genuinely missing there is a real defect, not a pending mint.

## Collision is accepted, not solved

This is local best-effort, not a coordination protocol. Two offline devices
can independently mint the same value (same object, same `SCOPE`) before
either syncs, because each device only ever sees its own storage — there is
no round trip, by design, since a device mints while offline. This is
accepted as the same optimistic-write tradeoff the rest of the runtime
already makes (record revisions, sync conflict resolution), **not a defect to
fix here**. Do not build a new cross-device coordination mechanism for
`AUTO_ID`; the existing authority-side conflict/rejection machinery is the
backstop. An author who needs a real collision caught rather than silently
duplicated should pair `AUTO_ID` with `CONSTRAINT ... UNIQUE FIELDS
<thatField>` on the same field — see `docs/spec/language.md`'s `AUTO_ID`
section, which documents this pairing explicitly.

## A command's `AUTO_ID` field is re-minted, not carried, across replay

A command step's `CREATE` never lists an `AUTO_ID` field in its own `values`
expression map — there is nothing meaningful to compute it from, the whole
point is that it is minted — so the value a device mints locally when it runs
a command offline and the value the authority mints when it re-executes that
same command from its own `input` (`command-service.ts`,
`command-intent-replay`'s "not as the writes it happened to produce" design)
can differ: they are two independent mints over two different views of
storage. This is not a new failure mode `AUTO_ID` introduces — it is the same
"the authority is authoritative, the device's copy is provisional until
reconciled" property every command-produced record already has — and
`ObjectStore.reconcileRemoteRecord` already overwrites the device's local
record with the authority's accepted one by `guid` once it syncs back, so the
device's displayed value converges to the authority's mint the same way any
other server-recomputed field would. No special-case handling was added for
this; it falls out of the existing reconciliation path for free.

## Practical guidance

- A model that declares `AUTO_ID` on a field that also wants uniqueness
  enforcement needs its own explicit `CONSTRAINT ... UNIQUE` — `AUTO_ID` does
  not imply one.
- `mintAutoIdValue`'s search is per-field and reads every record of the
  object on every create; this is the same "local best-effort" cost class as
  the rest of the offline-first runtime and was not optimized further in this
  phase.
- If a future phase adds a new storage backend, its `search` implementation
  must honour `includeDeleted: true` faithfully — minting depends on being
  able to see a deleted record's own value to avoid reissuing its number.
