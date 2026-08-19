# Reference App Models

Read this before adding or changing ADL reference applications, especially multi-context examples that exercise runtime policy, read models, offline datasets, or browser demo fixtures.

## Key decisions from Phase 17

- Reference apps should live in source-level fixtures, such as `src/reference/band-app.ts`, when browser code needs to import them. Test-only fixtures are still useful for narrow unit tests, but browser demos should not import from `tests/`.
- The band reference app uses the existing generic browser runtime. The local demo is selected with `/?demo=band` and uses IndexedDB through the existing storage backend.
- Context-role policies can match only when the target is a context object record or an object with an explicit `scope` field. Band-admin operations on objects such as invitations and set-list items need a `Band` lookup scope field.
- Current read models are primary-source plus lookup joins. Cross-band event feeds should use one primary `Event` object with an `EventType` field rather than separate `Gig` and `Rehearsal` primary sources.
- Offline dataset membership is separate from authorization. Phase 17 tests use both `evaluateOfflineDataset(...)` and `searchLocalDataset(...)` to prove that dataset selection and policy-shaped reads both work.
- `onlineRequired` objects are excluded from offline datasets. The band reference app models invitations as online-required because email dispatch and invitation acceptance need future remote/transaction support.
- Ordered set-list items are currently represented with a positive numeric `Position` field. Uniqueness, compaction, and batch reordering remain future generic platform work.

## Key decisions from Phase 18

- The band reference app now uses structured field equality policy conditions for user-owned `Availability` writes. Tests should assert direct runtime denials when `Availability.User` differs from `RuntimeContext.userId`.
- Invitation acceptance is represented by the generic `AcceptBandInvitation` command. It updates the invitation and creates membership through the runtime command service rather than a fixture-specific hook.
- The command-created `BandMember` write uses command authority, so direct non-admin membership creation remains denied while the command can complete after its invitation preconditions pass.
- The band fixture uses backend-neutral object constraints for scoped uniqueness and ordered positions: member per band, invitation email per band, availability date per user, song title per band, set-list name per band, streaming platform per song, and set-list item position per set list.
- Ordered set-list constraints now enforce positive integer positions and duplicate-position denial. Reorder/compaction behavior remains future generic command/helper work.

## Key decisions after the Giggle Band ADL conversion

- The band reference app is now a folder app under
  `src/reference/giggle-band/`. `app.yaml` lists the ADL source files and
  `domain.adl` currently holds the authored model. `src/reference/band-app.ts`
  remains the browser/runtime integration module and seed fixture, but the
  application definition is no longer a handwritten TypeScript partial model.
- Parser/compiler coverage for contexts, object scopes, constraints,
  view/read-model contexts, and read-model-backed views should be maintained
  with the Giggle Band compile test in `tests/compile-adl.test.ts`.

## Key decisions from Phase 25

- The Giggle Band folder app now lists `domain.adl` and `ui.adl` in
  `app.yaml`. `domain.adl` remains the domain/read-model/policy source, while
  `ui.adl` contributes the authored `HomeDashboard` composed-view
  presentation.
- `src/reference/band-app.ts` must import every manifest-listed ADL source as
  raw text and pass the same file names to `compileAdlProject`; otherwise the
  reference app fails before runtime seeding.

## Key decisions from Phase 28

- The Giggle home dashboard stays in `src/reference/giggle-band/ui.adl`; the
  browser renderer only gained generic composed-view shell and compact-feed
  styling.
- The schedule feed uses union read models for event rows plus current-user
  availability rows. `Event.EventType` stays limited to event categories such as
  `Gig` and `Rehearsal`; unavailable schedule rows come from `Availability.Status`
  projected through `HomeUpcomingEvents` and `CalendarPlanningItems`.
- The default demo seed leaves `PendingInvitations` empty for the home
  dashboard while command tests create explicit pending invitations. Keep
  invitation-command setup local to command tests so the reference dashboard can
  keep proving its empty-state presentation.

## Key decisions from Phase 56

- **A sync mode with no producer is a modelling error, not a platform gap.**
  `StreamingLink` declared `CACHE_READONLY` while offering create/update
  affordances. No local write and no authority replay may create a
  `cacheReadonly` record, so nobody using the deployed app could populate one.
  It is now band-authored (`LOCAL_FIRST`/`currentContext` with `BandAdmin`
  writes). When a mode and a surface disagree, fix the model — the platform
  behaviour was correct and deliberate.
- **The demo seeds only when no authority is configured.** Seeding into a
  deployment that has a real source of truth produced a queue of writes the
  authority refused and a recovery panel full of `ADL_POLICY_DENIED` before the
  operator had done anything. Fix the fixture, never the surface reporting the
  verdicts.
- **A runtime capability and a modelled permission are separate things, and so
  are a runtime capability and a runtime call site.** Phase 55 found `EXPORT`
  shipped with no rule granting it. Phase 56's sweep found worse: `import` is a
  declared policy action that parses and validates and has **no invocation site
  anywhere**. Audit both directions when adding a capability.
- **Creating a record does not mean you may read it back.** `CreateBand` was
  refused at the authority because `BandPolicy` granted `READ` only to
  `ROLE BandMember`, so the founder could not be shown the band they had just
  created. A create rule usually needs a matching read rule for the same
  principal, or the write succeeds and the caller is told it failed.
- **A projection that crosses users needs a policy vocabulary, not just a join.**
  The multi-hop read model can put a bandmate's availability in front of a
  caller; authorising that with `ROLE BandMember` would have granted every
  availability record in the system. That is what the `contextMember` principal
  is for.

## Key decisions from the sent-invitations / revoke lifecycle addition

- **A record-targeting row action is not yet buildable from a presentation
  `LIST`.** Adding an admin-facing "sent invitations" view with a one-click
  `Revoke` button on pending rows found that no `LIST` row — object- or
  read-model-backed — can pass its own record id into a `COMMAND`-invoking
  `ACTION`'s `INPUT`. See
  [ui-presentation-model#a-row-scoped-presentation-action-cannot-target-an-existing-record-by-id](ui-presentation-model.md)
  for the full mechanism. `RevokeBandInvitation` still exists and is
  exercised directly through `executeCommand`, matching how
  `AcceptBandInvitation` has been proven since Phase 28; the admin view
  (`MyInvitationList`) is read-only until that platform gap closes. Treat
  "add a one-click action against an existing row" as a request to check this
  first, not an assumption that the existing `ACTION addEvent CREATE Event`
  pattern generalises — it does not, because `CREATE` never needed an
  existing id in the first place.
- **A `READ_MODEL`-backed `DASHBOARD` view with no composed `SECTION`
  ignores the view's own `FIELDS` list.** `adl-dashboard-view.ts` always
  renders every field the read model projects, using the first non-date
  field (by the read model's own declaration order) as each row's bold
  title. `BandMemberAvailabilityBoard` and `SetListByPosition` happen to
  declare their first non-date field as the one worth reading; a read model
  whose first field is an internal lookup id (as `SentBandInvitations`'
  `Inviter` was, before being moved to project last) shows that id as the
  title instead. Order a read model's fields for this renderer, not only for
  logical grouping.

## Key decisions from the gig/availability content pass

Six content additions to `Event`, `Band`, `StreamingLink` and the availability
board — a `SetList` lookup on `Event`, rich gig fields (contact, payment,
`PreviousGig` self-reference), a `duplicateGig` presentation action, a
cross-band availability overlay, four more streaming platforms, and band
branding fields — done as application-layer content, no platform change.

- **`BandMemberAvailabilityBoard` moved out of `domain.adl` into `ui.adl`**,
  matching `HomeDashboard`/`BandEventCalendar`: any view that needs composed
  `SECTION`/`STATUS`/`CALENDAR` presentation is authored whole in `ui.adl`,
  never split across a plain declaration in `domain.adl` plus an add-on in
  `ui.adl` — `mergeViewOnlyObjectDeclarations` (`compile-adl.ts`) appends a
  second `OBJECT` block's views into the first only when that second block is
  otherwise field/scope/constraint-free, so a same-named view still has to be
  declared exactly once. Practical effect: the "first non-date field is the
  title" generic-dashboard-renderer rule from the sent-invitations addition
  above no longer applies to this view once it gained composed sections —
  that rule only governs a `READ_MODEL`-backed `DASHBOARD` with **no**
  composed `SECTION`.
- **A cross-band "you're already booked" overlay cannot name which band.** A
  read-model expression only ever sees `RUNTIME.userId`/`RUNTIME.now` — never
  which business context the *consuming view* has selected — so a status
  built from a `SCOPE allAvailableContexts` source cannot distinguish the
  selected band's own gig from a different band's. Labelling it "Gig with
  another band" was actively wrong on the selected band's own dates; "Gig
  booked" is what the data can actually support. See
  [read-model-runtime](read-model-runtime.md) for the mechanism that made the
  overlay admit the other band's records in the first place.
- **A validator name in a task description is not authority over what makes
  semantic sense.** Asked for an `Amount` field with a `CURRENCY_CODE`
  validator, `CURRENCY_CODE` checks for three uppercase letters (a currency
  *code* like `'GBP'`), which cannot validate a monetary amount and would
  reject every non-empty value. `giggle-new` itself has no separate currency
  field. Built as `NUMBER MIN 0` instead, matching the sibling app's actual
  `sql.NullString` amount column. Silently doing the literal, nonsensical
  thing would have shipped a field nobody could ever save a value into.
- **`PreviousGig FROM PreviousGig` on a `duplicateGig` row action copies
  lineage, not identity.** The action needed to duplicate every field but
  `Date`, and `PreviousGig` is one of them, but a presentation `ACTION`
  `INPUT` still cannot see a row's own record id (unchanged since the
  sent-invitations finding above) — so `INPUT PreviousGig FROM PreviousGig`
  forwards the *source* gig's own `PreviousGig` value rather than pointing
  the new gig back at the one being duplicated. Documented in place in
  `ui.adl` rather than silently omitted, so a future reader does not mistake
  it for an oversight.

## Key decisions from the Jointly Care ADL conversion

A second folder app, `src/reference/jointly-care/` (`app.yaml`, `domain.adlj`,
`ui.adlj`, integration module `src/reference/jointly-app.ts`), converting the
Phoenix/LiveView PRD at `OSV_PRD_Elixir_Canonical_Jointly.md` into an
ADL-native equivalent: `Circle`/`CircleMember`/`CircleInvite` mirror
`Band`/`BandMember`/`BandInvitation`'s shape closely enough to reuse most of
Giggle Band's proven patterns (`CONTEXT ... MEMBERSHIP`, a
`CONTEXT_GRANT` for a pending invite, `AcceptCircleInvite`/`CreateCircle`
commands, a `PROTECTED_ROLE` last-owner-standing constraint), plus
`Event`/`Note`/`Message`/`Reminder` for the calendar/notes/messaging domain
the PRD adds. Wired into the browser demo picker (`?demo=jointly-care`) and
covered by its own Playwright visual spec
(`tests/visual/jointly-care.visual.spec.ts`), alongside Giggle Band's.

- **`DISPLAY` cannot name a `COMPUTED` field.** `OBJECT_DISPLAY_FIELD_UNKNOWN`
  validation resolves `displayField` against `object.fields` only, not
  `object.computedFields` (`validate-model.ts`'s `fieldsByName` for that check
  is `indexByName(object.fields)`). Tried to give `User` a `DisplayName ??
  Email` computed fallback for the PRD's "an empty display_name renders as the
  email prefix" behaviour; had to fall back to `DISPLAY Email` directly
  instead. A stored field is the only thing `DISPLAY` (or `KEY`) can ever
  name. Now documented in
  [docs/spec/language.md#objects-and-fields](../../docs/spec/language.md#objects-and-fields).
- **A `ROLE` condition on `User` can never match a role earned through a
  different context**, and **a `WHEN`-conditioned `SEARCH` rule can never
  match at all** -- both are policy-engine mechanics, not modelling choices;
  see [policy-engine#key-decisions-from-the-jointly-care-reference-app](policy-engine.md)
  for the full mechanism and
  [docs/spec/language.md#policies](../../docs/spec/language.md#policies) for
  the user-facing writeup (the `SEARCH`+`WHEN` case is now a compile error,
  `ADL_POLICY_SEARCH_CONDITION_UNREACHABLE`, not just a documented footgun).
  Practical fallout here: `UserPolicy` moved from `ROLE CircleMember` (copied
  from Giggle Band's own `UserPolicy`, which has the identical, apparently
  never-exercised gap) to `AUTHENTICATED`, and `CircleInvitePolicy`'s
  invitee-facing `SEARCH` rule had to drop its `WHEN Invitee ==
  runtime.userId` and become unconditioned, leaning on the paired `READ` rule
  for row shaping.
- **A `CONTEXT_GRANT` does not extend to the context's own root object.**
  `MyPendingCircleInvites` (the cross-circle "invites addressed to me" read
  model `PendingInvitations`-style views need, which Giggle Band never built
  and so never hit this) originally joined from `CircleInvite` to `Circle` to
  show which circle each invite belonged to. A pending invitee has no
  `CirclePolicy` rule granting them `READ` on a `Circle` they have not joined
  -- `pendingCircleInvite`'s grant only ever reaches `CircleInvite` records --
  so the join silently dropped every row for exactly the caller the view
  exists for. Removed the join; the view shows invitee/status/date without
  naming the circle, documented in place the same way the cross-band "cannot
  name which band" gig-overlay finding is. Now documented in
  [docs/spec/language.md#context-grants](../../docs/spec/language.md#context-grants).
- **A visible row action that would always fail for its own caller is worth
  gating even when the command's own guard already refuses it safely.**
  `MyPendingCircleInvites`' primary source has to stay a broad
  `AUTHENTICATED` search (the point above), which means the read model also
  surfaces a `CircleOwner`'s own *outgoing* invites via their unconditioned
  `allowCircleOwnerReadInvites` rule, not only invites addressed to the
  caller. `AcceptCircleInvite`/`DeclineCircleInvite` would both correctly
  refuse a click from the owner (`REQUIRE Invitee == runtime.userId`), but the
  buttons still rendered on every row regardless of who it was addressed to
  until `Invitee` was added to the read model's projection purely so the row
  `ACTION`s could gate on `WHEN Invitee == runtime.userId` -- the same
  "don't offer a button that always fails" reasoning as Giggle Band's
  `revoke` action's `WHEN Status == 'Pending'`.
- **`AUTHORITY command` steps operate ahead of the caller's own
  `RuntimeContext`, so a caller-held context object can go stale mid-test (and
  mid-session) the moment a command creates the membership that would update
  it.** `withSelectedContext` resolves `contextRoles`/`contextGrants` once, at
  call time; `AcceptCircleInvite`'s `createMembership` step writes a new
  `CircleMember` through `AUTHORITY command` (bypassing the acting caller's
  own policy entirely, same as Giggle Band's `AcceptBandInvitation`), but the
  `RuntimeContext` object the caller already holds does not retroactively
  learn about it. A caller who needs to search/read using their *new* role
  immediately afterward has to call `withSelectedContext` again (or a test can
  reach for a system/admin context to verify write outcomes, which is what
  `jointly-reference-app.test.ts` does).

## Practical guidance

- Avoid app-specific runtime hooks in reference apps unless a phase explicitly asks for them. If a workflow needs hooks or commands, document the gap and promote it to a generic platform phase.
- Prefer union read models when a reference surface must present records from
  distinct domain objects without pretending one object is another.
- When modeling user-owned records, prefer structured policy conditions over owner-convention checks when the business owner is a field such as `User`.
- **New reference apps should be authored as `.adlj`, not `.adl` text, going
  forward.** See `docs/spec/adlj.md` (its "Authoring a `.adlj` document from
  scratch" section is the concrete how-to) and
  `implementation/adlj-json-authoring-surface.md` for the format itself.
  `.adl` text is a generated, human-reviewable view produced from `.adlj` via
  `print-adl.ts` for review/diffing, not something to hand-author for a new
  app. Jointly Care (`src/reference/jointly-care/`) is the first real
  `.adlj` reference-app precedent: `app.yaml` compiles `domain.adlj`/
  `ui.adlj`, and both files carry every one of the app's original
  design-rationale comments (17 total) as real `"comment"` keys — there is
  no separate `.adl` file kept on disk for rationale any more, that earlier
  gap having been closed by giving `.adlj` a first-class comment field (see
  `implementation/adlj-json-authoring-surface.md`'s "Comments" section).
  Giggle Band (`src/reference/giggle-band/`) predated this direction but has
  since been converted too: `app.yaml` compiles `domain.adlj`/`ui.adlj`
  (via `importAdlAsAdlj`, same conversion mechanism, all 14 real comments
  preserved), `src/reference/band-app.ts` compiles them lazily behind a
  dynamic `import()` the same way `jointly-app.ts` does, and every construct
  Giggle Band exercises that Jointly Care doesn't (`UNION`, `ORDERED`,
  `CHILD_COLLECTION`/`PICKER`, `ICON_MAP`/`STATUS_MAP`, a multi-hop
  `READ_MODEL SOURCE JOIN`, `EDIT_SECTION`) round-tripped with no converter
  changes needed. `domain.adl`/`ui.adl` are kept on disk, unmodified, with a
  trailing (not header) superseded-as-compiled-source note, because
  `docs/spec/language.md` and several `docs/phases/*.md` documents cite
  exact line numbers into them — see
  `implementation/adlj-json-authoring-surface.md`'s "Giggle Band's `.adlj`
  conversion" section for the full account, including the generic
  `authority-entrypoint.ts` model loader and the pre-existing synchronous
  test surface that conversion also had to update.
