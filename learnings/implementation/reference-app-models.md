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

## Practical guidance

- Avoid app-specific runtime hooks in reference apps unless a phase explicitly asks for them. If a workflow needs hooks or commands, document the gap and promote it to a generic platform phase.
- Prefer union read models when a reference surface must present records from
  distinct domain objects without pretending one object is another.
- When modeling user-owned records, prefer structured policy conditions over owner-convention checks when the business owner is a field such as `User`.
