import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityService,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  StaticSessionAdapter,
} from "../../src/index.js";
import type { AuthorityOutcome, StoredObjectRecord } from "../../src/index.js";
import { createGiggleBandExampleModel } from "../../src/reference/band-app.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 105's authority half, against real PostgreSQL.
 *
 * Policy and command authorisation are authority-side claims, and `AGENTS.md`
 * will not accept a fake for one. The specific thing that has to be true here is
 * unusual enough to be worth stating: the caller is a member of **nothing**.
 * Their only route to the band is `pendingBandInvitation`, a `CONTEXT_GRANT`
 * whose own record is the invitation the command is about — so the object-scope
 * gate, `PostgresContextMembershipIndex` and the policy engine all have to agree
 * about somebody who does not appear in the membership projection at all.
 *
 * It serves the **real Giggle Band model** through
 * `createGiggleBandExampleModel()`. A fixture with a hand-written
 * accept-shaped command would prove something about the fixture.
 *
 * Everything is asserted by reading rows back out of `adl_authority_records`
 * rather than from the outcome the service returned. The outcome is the server
 * describing its own work; the rows are the work.
 */

const applicationId = "invitation-accept-app";
const founderToken = "f".repeat(48);
const inviteeToken = "i".repeat(48);
const strangerToken = "s".repeat(48);
const founderId = "user-founder";
const inviteeId = "user-invitee";
const strangerId = "user-stranger";

const model = await createGiggleBandExampleModel();

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, applicationId, model.modelVersion);
});

/** Wired the way the authority process wires it. */
function service(): AuthorityService {
  const queryable = authorityPool(pool);
  return new AuthorityService(
    model,
    new PostgresObjectStorageBackend(queryable, applicationId, model),
    new StaticSessionAdapter(
      new Map([
        [founderToken, { userId: founderId }],
        [inviteeToken, { userId: inviteeId }],
        [strangerToken, { userId: strangerId }],
      ]),
    ),
    {
      unitOfWork: new PostgresAuthorityUnitOfWork(queryable, applicationId, model),
      membershipIndex: new PostgresContextMembershipIndex(queryable, applicationId),
    },
  );
}

async function storedRecord(
  objectName: string,
  recordId: string,
): Promise<StoredObjectRecord | null> {
  const result = await pool.query<{ record: StoredObjectRecord }>(
    "select record from adl_authority_records where application_id=$1 and object_name=$2 and record_id=$3",
    [applicationId, objectName, recordId],
  );
  return result.rows[0]?.record ?? null;
}

function requireAccepted(outcome: AuthorityOutcome): AuthorityOutcome {
  if (outcome.status !== "accepted") {
    throw new Error(`Expected an accepted outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

/**
 * A band, its founding `BandAdmin`, one `Pending` invitation for the invitee,
 * and some band-scoped content the invitee has no business seeing.
 */
async function seedBandWithPendingInvitation(authority: AuthorityService): Promise<void> {
  requireAccepted(
    await authority.replay(founderToken, {
      operationId: "op-create-band",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Alphas" },
      recordIds: [
        { step: "createBand", objectName: "Band", recordId: "band-1" },
        { step: "createFounderMembership", objectName: "BandMember", recordId: "member-founder" },
      ],
    }),
  );

  requireAccepted(
    await authority.replay(founderToken, {
      operationId: "op-create-invitation",
      kind: "create",
      objectName: "BandInvitation",
      recordId: "invitation-1",
      values: {
        Band: "band-1",
        Inviter: founderId,
        Invitee: inviteeId,
        InviteeEmail: "invitee@example.com",
        Status: "Pending",
        SentAt: "2026-07-07",
      },
      selectedContexts: { Band: "band-1" },
    }),
  );

  // A second invitation the same band sent to somebody else. Nothing the
  // invitee may read, and the record that makes "only their own" mean
  // something in the bootstrap assertions below.
  requireAccepted(
    await authority.replay(founderToken, {
      operationId: "op-create-other-invitation",
      kind: "create",
      objectName: "BandInvitation",
      recordId: "invitation-other",
      values: {
        Band: "band-1",
        Inviter: founderId,
        InviteeEmail: "someone.else@example.com",
        Status: "Pending",
        SentAt: "2026-07-06",
      },
      selectedContexts: { Band: "band-1" },
    }),
  );

  requireAccepted(
    await authority.replay(founderToken, {
      operationId: "op-create-song",
      kind: "create",
      objectName: "Song",
      recordId: "song-1",
      values: { Band: "band-1", Title: "Neon Map", Composer: "Casey Morgan" },
      selectedContexts: { Band: "band-1" },
    }),
  );

  requireAccepted(
    await authority.replay(founderToken, {
      operationId: "op-create-event",
      kind: "create",
      objectName: "Event",
      recordId: "event-1",
      values: {
        Band: "band-1",
        EventType: "Gig",
        Date: "2026-08-01",
        StartTime: "20:00",
        EndTime: "22:00",
        Title: "Canal Street headline",
        VenueName: "Alpha Hall",
        CreatedBy: founderId,
      },
      selectedContexts: { Band: "band-1" },
    }),
  );
}

/** The intent a device replays for one `Accept` click. */
function acceptIntent(operationId: string, membershipId: string, selected: boolean) {
  return {
    operationId,
    kind: "command" as const,
    commandName: "AcceptBandInvitation",
    input: { Invitation: "invitation-1" },
    recordIds: [{ step: "createMembership", objectName: "BandMember", recordId: membershipId }],
    ...(selected ? { selectedContexts: { Band: "band-1" } } : { selectedContexts: {} }),
  };
}

describe("an invitee accepting a band invitation through the authority", () => {
  /**
   * J+ `expectInviteeAcceptCommitsThroughTheAuthority`.
   *
   * The caller holds no membership record anywhere. What lets the write through
   * is `pendingBandInvitation` resolving over the real projection inside the
   * unit of work, and the proof is the two rows in `adl_authority_records`, not
   * the response.
   */
  it("expectInviteeAcceptCommitsThroughTheAuthority", async () => {
    const authority = service();
    await seedBandWithPendingInvitation(authority);

    // The invitee is nobody in the membership projection before the click.
    const membershipsBefore = await pool.query<{ user_id: string }>(
      "select user_id from adl_authority_context_memberships where application_id=$1",
      [applicationId],
    );
    expect(membershipsBefore.rows.map((row) => row.user_id)).toEqual([founderId]);

    requireAccepted(
      await authority.replay(inviteeToken, acceptIntent("op-accept", "member-invitee", true)),
    );

    const invitation = await storedRecord("BandInvitation", "invitation-1");
    expect(invitation?.values.Status).toBe("Accepted");
    expect(invitation?.values.RespondedAt).toEqual(expect.any(String));

    const membership = await storedRecord("BandMember", "member-invitee");
    expect(membership?.values).toMatchObject({
      User: inviteeId,
      Band: "band-1",
      Role: "BandMember",
    });

    // And the membership projection now carries them, which is what makes the
    // context reachable by role on their next request rather than by grant.
    const projected = await pool.query<{
      user_id: string;
      role: string;
      revoked_at: string | null;
    }>(
      "select user_id, role, revoked_at from adl_authority_context_memberships where application_id=$1 and membership_record_id=$2",
      [applicationId, "member-invitee"],
    );
    expect(projected.rows).toEqual([{ user_id: inviteeId, role: "BandMember", revoked_at: null }]);
  });

  /**
   * J− `expectNonInviteeAcceptRejectedByTheAuthority`.
   *
   * A rejection response with a committed write is the failure mode this half
   * exists to catch, so the invitation row is compared **byte for byte** —
   * same revision, same record — rather than merely re-read for its status.
   *
   * Two non-invitees, because they are refused at two different layers and
   * asserting only one of them would leave the other unpinned:
   *
   * - the **stranger** cannot reach the band at all, so naming it in the intent
   *   fails in `withSelectedContext` before the command is considered
   *   (`ADL_RUNTIME_CONTEXT_ERROR`);
   * - the **founder** is a `BandAdmin` and reaches the band perfectly well, so
   *   their replay gets as far as the command's own
   *   `REQUIRE Invitee == RUNTIME.userId` step guard (`ADL_POLICY_DENIED`).
   *
   * The phase document predicted `ADL_POLICY_DENIED` for the first of these.
   * Measured, it is the context error; the code asserted below is the one the
   * authority actually returns.
   */
  it("expectNonInviteeAcceptRejectedByTheAuthority", async () => {
    const authority = service();
    await seedBandWithPendingInvitation(authority);
    const before = await storedRecord("BandInvitation", "invitation-1");

    expect(
      await authority.replay(
        strangerToken,
        acceptIntent("op-accept-stranger", "member-stranger", true),
      ),
    ).toMatchObject({ status: "rejected", code: "ADL_RUNTIME_CONTEXT_ERROR" });

    expect(
      await authority.replay(
        founderToken,
        acceptIntent("op-accept-founder", "member-founder-again", true),
      ),
    ).toMatchObject({ status: "rejected", code: "ADL_POLICY_DENIED" });

    expect(await storedRecord("BandInvitation", "invitation-1")).toEqual(before);
    expect(await storedRecord("BandMember", "member-stranger")).toBeNull();
    expect(await storedRecord("BandMember", "member-founder-again")).toBeNull();
    const memberships = await pool.query<{ user_id: string }>(
      "select user_id from adl_authority_context_memberships where application_id=$1",
      [applicationId],
    );
    expect(memberships.rows.map((row) => row.user_id)).toEqual([founderId]);
  });

  /**
   * The gap this phase measured rather than inherited, and could not close
   * inside its own scope.
   *
   * A `CONTEXT ALL` screen deliberately holds **no** selected context — that is
   * what makes it cross-context — so the operation log records
   * `selectedContexts: {}` for a command run from it and `toIntent`
   * (`src/server/sync-client.ts`) sends exactly that. `AuthorityService.
   * resolveContext` keeps a deliberately narrow resolution for a replay: it
   * iterates `intent.selectedContexts` and nothing else, on the stated grounds
   * that "a write must land in a context the client actually named". With
   * neither side naming the context, the object-scope gate refuses.
   *
   * Measured, not reasoned: the queued entry really does carry `{}`, and this
   * really is the outcome. So an invitee's `Accept` commits locally and is
   * refused on delivery in any deployment that has an authority — in **both**
   * shipped applications, since `BandInvitation` and `CircleInvite` are both
   * `SYNC onlineRequired`. Phase 105 fixed the browser runtime path; this is
   * the same defect one layer further out and it needs a decision the phase's
   * own Decision section explicitly declined to make here (widening replay
   * resolution was rejected outright, and rightly).
   *
   * This case pins the behaviour as it is, so the gap is asserted rather than
   * invisible, and the Planning Handoff carries it. It is not an endorsement:
   * when it is closed, this case is the one that must change, and the change
   * will be visible.
   */
  it("expectContextAllIntentWithNoSelectionIsRejectedByTheAuthority", async () => {
    const authority = service();
    await seedBandWithPendingInvitation(authority);
    const before = await storedRecord("BandInvitation", "invitation-1");

    const outcome = await authority.replay(
      inviteeToken,
      acceptIntent("op-accept-no-selection", "member-no-selection", false),
    );

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "ADL_POLICY_DENIED",
      message: "Policy denied update on object 'BandInvitation' outside its runtime context scope.",
    });

    // Nothing moved, so the local device and the authority genuinely disagree.
    expect(await storedRecord("BandInvitation", "invitation-1")).toEqual(before);
    expect(await storedRecord("BandMember", "member-no-selection")).toBeNull();

    // The control that makes this a statement about the *selection* and not
    // about the caller: the identical intent, from the identical identity, with
    // the band named, commits.
    requireAccepted(
      await authority.replay(inviteeToken, acceptIntent("op-accept-named", "member-named", true)),
    );
    expect((await storedRecord("BandInvitation", "invitation-1"))?.values.Status).toBe("Accepted");
  });

  /**
   * J± `expectBootstrapCarriesTheInvitationAndNothingElse`.
   *
   * Positive and negative in one call, because they are one question: what
   * lands on the invitee's device. `AuthorityService.bootstrap` selects by read
   * policy rather than by declared sync scope, so this is the only place the
   * answer can be established.
   */
  it("expectBootstrapCarriesTheInvitationAndNothingElse", async () => {
    const authority = service();
    await seedBandWithPendingInvitation(authority);

    const bootstrap = await authority.bootstrap(inviteeToken, {});
    const byObject = bootstrap.records.map((entry) => ({
      objectName: entry.objectName,
      recordId: entry.record.meta.guid,
    }));

    // Their own invitation, and *only* that. Asserted as an exhaustive list
    // rather than a `toContain`: a bootstrap that carried the band's other
    // invitation, its roster or its gigs would still contain this one.
    expect(byObject).toEqual([{ objectName: "BandInvitation", recordId: "invitation-1" }]);

    // Named individually as well, because the list above is only as good as the
    // records the seed created for it to exclude. `BandMember` in particular: a
    // roster is exactly what a pending invitee must not receive. `Band` too —
    // `allowAuthenticatedReadBandName` grants the name as a *field*, and a
    // whole-record read is what a bootstrap performs, so the band record itself
    // must not travel.
    for (const objectName of ["Event", "Song", "Availability", "BandMember", "Band"]) {
      expect(byObject.map((entry) => entry.objectName)).not.toContain(objectName);
    }

    // Phase 99 asserted that no `@` reaches a device at all. That is not the
    // right claim on this path and measuring it is what showed so: an
    // invitation *names the address it was sent to*, and the person it was sent
    // to is entitled to their own. The claim that holds — and the one worth
    // holding — is that nobody else's address travels.
    const payload = JSON.stringify(bootstrap.records);
    expect(payload).toContain("invitee@example.com");
    expect(payload).not.toContain("someone.else@example.com");
  });
});
