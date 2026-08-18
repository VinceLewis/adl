import { describe, expect, it } from "vitest";
import {
  AuthorityService,
  InMemoryObjectStorageBackend,
  StaticSessionAdapter,
  resolveApplicationModel,
} from "../src/index.js";
import { createGiggleBandExampleModel } from "../src/ui/demo-fixture.js";
import type {
  AuthorityCommandRecordId,
  AuthorityOperationIntent,
  AuthorityOutcome,
  PartialApplicationModel,
} from "../src/index.js";

/**
 * What the Phase 56 commands do when they reach the authority.
 *
 * Both new command shapes — a batch (`ImportSongs`) and one that creates a
 * business context together with its first membership (`CreateBand`) — depend on
 * every step landing in one transaction. This file pins where that guarantee
 * survives the sync boundary and where it does not, because the answer differs
 * by intent kind and the difference is invisible from the runtime alone.
 *
 * Phase 57 adds the second half of the guarantee. A command intent is
 * *re-executed* server-side, so without being told otherwise the authority would
 * mint fresh ids for every record it creates and return them for rows the
 * originating device does not have — the Phase 48 duplication defect reached by
 * a different route. The intent therefore carries a manifest of the ids the
 * device already minted, and the cases below pin what that manifest buys and
 * what it refuses.
 */
const SESSION_TOKEN = "replay-token-replay-token-replay-token";

function startAuthority() {
  const model = createGiggleBandExampleModel();
  const storage = new InMemoryObjectStorageBackend();
  const sessions = new StaticSessionAdapter(new Map([[SESSION_TOKEN, { userId: "user-founder" }]]));
  return { authority: new AuthorityService(model, storage, sessions), storage };
}

function acceptedRecords(outcome: AuthorityOutcome) {
  if (outcome.status !== "accepted") {
    throw new Error(`Expected an accepted outcome, got ${outcome.status}.`);
  }
  return outcome.records;
}

function rejection(outcome: AuthorityOutcome): { code: string; message: string } {
  if (outcome.status !== "rejected") {
    throw new Error(`Expected a rejected outcome, got ${outcome.status}.`);
  }
  return { code: outcome.code, message: outcome.message };
}

/**
 * The manifest a device that ran `CreateBand` locally would hold: one entry per
 * create step, in the order the command plans them. The update-only steps of
 * other commands never appear in a manifest — an update names an existing record
 * through its own `ID` expression.
 */
function createBandManifest(bandId: string, membershipId: string): AuthorityCommandRecordId[] {
  return [
    { step: "createBand", objectName: "Band", recordId: bandId },
    { step: "createFounderMembership", objectName: "BandMember", recordId: membershipId },
  ];
}

/** One entry per item of the single `FOR EACH` step `ImportSongs` declares. */
function importSongsManifest(recordIds: readonly string[]): AuthorityCommandRecordId[] {
  return recordIds.map((recordId, itemIndex) => ({
    step: "importSongs",
    itemIndex,
    objectName: "Song",
    recordId,
  }));
}

async function establishBand(
  authority: AuthorityService,
  operationId: string,
  name: string,
  bandId: string,
  membershipId: string,
): Promise<string> {
  const outcome = await authority.replay(SESSION_TOKEN, {
    operationId,
    kind: "command",
    commandName: "CreateBand",
    input: { Name: name },
    recordIds: createBandManifest(bandId, membershipId),
  });
  acceptedRecords(outcome);
  return bandId;
}

async function storedIds(
  storage: InMemoryObjectStorageBackend,
  objectName: string,
): Promise<string[]> {
  return (await storage.listRecords())
    .filter((entry) => entry.objectName === objectName)
    .map((entry) => entry.record.meta.guid)
    .sort();
}

describe("authority replay of context-establishing and batch commands", () => {
  it("accepts a command that creates a context and its first membership together", async () => {
    const { authority } = startAuthority();

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-create-band",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Alphas", Description: "Founded through the command" },
      recordIds: createBandManifest("band-alphas", "member-alphas"),
    });

    const records = acceptedRecords(outcome);
    const band = records.find((record) => record.meta.object === "Band");
    const membership = records.find((record) => record.meta.object === "BandMember");

    expect(band?.values.Name).toBe("The Alphas");
    expect(band?.values.CreatedBy).toBe("user-founder");
    // The membership is scoped to a band that did not exist when the transaction
    // opened. Both records come back, which is the whole point: the caller is
    // told what they created rather than being refused a description of it.
    expect(membership?.values.Band).toBe(band?.meta.guid);
    expect(membership?.values.Role).toBe("BandAdmin");
    expect(membership?.values.User).toBe("user-founder");
  });

  it("shapes the response for who the caller became, not who they were", async () => {
    const { authority } = startAuthority();

    // Before this command the caller is a member of nothing, so the pre-write
    // context cannot read a `BandMember` record scoped to the new band. Shaping
    // the response against it returned a rejection for a write that had already
    // committed — accepted state and a denial for the same operation.
    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-shaping",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Betas" },
      recordIds: createBandManifest("band-betas", "member-betas"),
    });

    expect(outcome.status).toBe("accepted");
    expect(
      acceptedRecords(outcome)
        .map((record) => record.meta.object)
        .sort(),
    ).toEqual(["Band", "BandMember"]);
  });

  it("accepts a batch command as one atomic intent", async () => {
    const { authority } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-import",
      "The Gammas",
      "band-gammas",
      "member-gammas",
    );

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-import",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: bandId,
        Songs: [
          { Title: "Neon Map", Composer: "Ada" },
          { Title: "Slow Harbour", Composer: "Grace" },
          { Title: "Third Rail" },
        ],
      },
      recordIds: importSongsManifest(["song-neon", "song-harbour", "song-rail"]),
      selectedContexts: { Band: bandId },
    });

    const songs = acceptedRecords(outcome);
    expect(songs).toHaveLength(3);
    expect(songs.map((record) => record.values.Title)).toEqual([
      "Neon Map",
      "Slow Harbour",
      "Third Rail",
    ]);
    expect(songs.every((record) => record.meta.object === "Song")).toBe(true);
  });

  it("refuses a batch whose items are invalid without writing any of them", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-bad-import",
      "The Deltas",
      "band-deltas",
      "member-deltas",
    );

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-bad-import",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: bandId,
        // The second item omits the required `Title`, so the whole batch must
        // fail. A partially applied import would leave the caller unable to say
        // what landed.
        Songs: [{ Title: "Good" }, { Composer: "Missing a title" }],
      },
      recordIds: importSongsManifest(["song-good", "song-bad"]),
      selectedContexts: { Band: bandId },
    });

    expect(outcome.status).toBe("rejected");
    const songs = (await storage.listRecords()).filter(({ objectName }) => objectName === "Song");
    expect(songs).toHaveLength(0);
  });

  /**
   * The gap this phase leaves open, pinned deliberately rather than left to be
   * rediscovered.
   *
   * `sync-client.ts` converts a locally executed command into one ordinary
   * create/update intent per step — `LocalOperationKind` has no `command`
   * variant — so an offline-created band arrives as two unrelated intents. The
   * membership intent then names a context the caller is not yet a member of,
   * and the authority refuses it, because the transaction that would have made
   * them a member is exactly the thing that was split apart.
   *
   * The command *intent* path above works. What does not exist is a client that
   * emits it.
   */
  it("refuses the same command replayed as separate per-record intents", async () => {
    const { authority } = startAuthority();

    const band = await authority.replay(SESSION_TOKEN, {
      operationId: "op-split-band",
      kind: "create",
      objectName: "Band",
      recordId: "band-split-1",
      values: { Name: "The Epsilons", CreatedBy: "user-founder" },
    });
    expect(band.status).toBe("accepted");

    const membership = await authority.replay(SESSION_TOKEN, {
      operationId: "op-split-membership",
      kind: "create",
      objectName: "BandMember",
      recordId: "member-split-1",
      values: {
        User: "user-founder",
        Band: "band-split-1",
        Role: "BandAdmin",
        JoinedAt: "2026-07-31",
      },
      selectedContexts: { Band: "band-split-1" },
    });

    expect(membership.status).toBe("rejected");
    expect(membership.status === "rejected" ? membership.code : "").toBe(
      "ADL_RUNTIME_CONTEXT_ERROR",
    );
  });
});

/**
 * Who names the records a replayed command creates.
 *
 * The device already holds ids for them: it ran the command locally, showed the
 * results, and queued the whole transaction. If the authority's re-execution
 * mints its own, every accepted record comes back naming a row nobody has, the
 * local rows stay `local` forever with their queue entry already discarded, and
 * the user sees each record twice. That is the Phase 48 defect, and a command is
 * simply the version of it that spans several records at once.
 */
describe("record identity across a replayed command", () => {
  it("gives every created record the id the intent named, across steps and objects", async () => {
    const { authority, storage } = startAuthority();

    const records = acceptedRecords(
      await authority.replay(SESSION_TOKEN, {
        operationId: "op-named-band",
        kind: "command",
        commandName: "CreateBand",
        input: { Name: "The Zetas" },
        recordIds: createBandManifest("band-zetas", "member-zetas"),
      }),
    );

    // In planned order, under the names the device chose, for both objects.
    expect(records.map((record) => [record.meta.object, record.meta.guid])).toEqual([
      ["Band", "band-zetas"],
      ["BandMember", "member-zetas"],
    ]);
    // And that is what actually landed, not merely what was reported back.
    expect(await storedIds(storage, "Band")).toEqual(["band-zetas"]);
    expect(await storedIds(storage, "BandMember")).toEqual(["member-zetas"]);
    // The membership points at the band under the *supplied* id, so a device
    // that reconciles both rows finds the relationship already resolved.
    expect(records[1]?.values.Band).toBe("band-zetas");
  });

  it("gives every item of a FOR EACH step the id the intent named for that item", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-named-import",
      "The Etas",
      "band-etas",
      "member-etas",
    );
    const ids = ["song-one", "song-two", "song-three", "song-four"];

    const songs = acceptedRecords(
      await authority.replay(SESSION_TOKEN, {
        operationId: "op-named-import",
        kind: "command",
        commandName: "ImportSongs",
        input: {
          Band: bandId,
          Songs: [{ Title: "One" }, { Title: "Two" }, { Title: "Three" }, { Title: "Four" }],
        },
        recordIds: importSongsManifest(ids),
        selectedContexts: { Band: bandId },
      }),
    );

    // Item M of the step keeps the id named for item M. An off-by-one here is
    // invisible in the record count and catastrophic in the rows: every song
    // would carry another song's identity.
    expect(songs.map((record) => [record.meta.guid, record.values.Title])).toEqual([
      ["song-one", "One"],
      ["song-two", "Two"],
      ["song-three", "Three"],
      ["song-four", "Four"],
    ]);
    expect(await storedIds(storage, "Song")).toEqual([...ids].sort());
  });

  it("refuses a manifest that names an id already taken, and writes none of the command", async () => {
    const { authority, storage } = startAuthority();
    await establishBand(authority, "op-band-first", "The Thetas", "band-thetas", "member-thetas");

    // A fresh band id, but the membership reuses an id that already names a
    // record. The collision surfaces on the *second* step, so a command that
    // committed as it went would have left the band behind.
    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-band-collision",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Iotas" },
      recordIds: createBandManifest("band-iotas", "member-thetas"),
    });

    expect(rejection(outcome).code).toBe("ADL_RUNTIME_RECORD_ID_TAKEN");
    // Nothing the command would have written exists: not the band from the step
    // that was authorised, and no second membership. Asserting the verdict alone
    // would not distinguish "refused" from "refused after writing half of it".
    expect(await storedIds(storage, "Band")).toEqual(["band-thetas"]);
    expect(await storedIds(storage, "BandMember")).toEqual(["member-thetas"]);
  });

  it("refuses a batch whose manifest collides on one item, and imports none of it", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-collide",
      "The Kappas",
      "band-kappas",
      "member-kappas",
    );
    await authority.replay(SESSION_TOKEN, {
      operationId: "op-first-import",
      kind: "command",
      commandName: "ImportSongs",
      input: { Band: bandId, Songs: [{ Title: "Already here" }] },
      recordIds: importSongsManifest(["song-existing"]),
      selectedContexts: { Band: bandId },
    });

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-colliding-import",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: bandId,
        Songs: [{ Title: "Fresh" }, { Title: "Collides" }, { Title: "Also fresh" }],
      },
      // The middle item names a song that already exists. One taken id refuses
      // the batch: the alternative is an import the user cannot describe.
      recordIds: importSongsManifest(["song-fresh", "song-existing", "song-also-fresh"]),
      selectedContexts: { Band: bandId },
    });

    expect(rejection(outcome).code).toBe("ADL_RUNTIME_RECORD_ID_TAKEN");
    expect(await storedIds(storage, "Song")).toEqual(["song-existing"]);
  });

  /**
   * Regression, found against real PostgreSQL.
   *
   * A collision with an *existing* record is caught by reading storage, but every
   * write in a command is planned before any of them is committed, so the second
   * plan's lookup could not see the id the first plan had just claimed. Both
   * plans passed and the duplicate landed as a primary-key violation at commit —
   * which is not a `RuntimeError`, so `classifyFailure` returned null, `replay`
   * rethrew, the client read it as a transport failure, and the queue entry
   * stayed replayable for ever. A manifest that can never be accepted was
   * retried until someone looked.
   *
   * The manifest is now checked against itself before any write is planned, and
   * the verdict is the same `ADL_RUNTIME_RECORD_ID_TAKEN` rejection an existing
   * record produces: the question and the caller's remedy are identical, and a
   * rejection is terminal where a transport error is not.
   */
  it("refuses a manifest that names the same id twice for one object", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-dupes",
      "The Sigmas",
      "band-sigmas",
      "member-sigmas",
    );

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-duplicate-manifest",
      kind: "command",
      commandName: "ImportSongs",
      input: { Band: bandId, Songs: [{ Title: "First" }, { Title: "Second" }] },
      // Two songs, one name. No execution of this command can ever be accepted,
      // so it must be refused durably rather than attempted for ever.
      recordIds: importSongsManifest(["song-same", "song-same"]),
      selectedContexts: { Band: bandId },
    });

    expect(rejection(outcome).code).toBe("ADL_RUNTIME_RECORD_ID_TAKEN");
    expect(rejection(outcome).message).toContain("more than once");
    // Refused before anything was planned, let alone committed.
    expect(await storedIds(storage, "Song")).toEqual([]);
  });

  it("accepts the same id under two different objects, because storage keys per object", async () => {
    const { authority, storage } = startAuthority();

    // A record id is only unique within its object. Refusing this would reject
    // work the storage layer has no objection to at all, and a device is free to
    // mint ids per object however it likes.
    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-shared-id",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Taus" },
      recordIds: createBandManifest("shared-id", "shared-id"),
    });

    expect(
      acceptedRecords(outcome).map((record) => [record.meta.object, record.meta.guid]),
    ).toEqual([
      ["Band", "shared-id"],
      ["BandMember", "shared-id"],
    ]);
    expect(await storedIds(storage, "Band")).toEqual(["shared-id"]);
    expect(await storedIds(storage, "BandMember")).toEqual(["shared-id"]);
  });
});

/**
 * A manifest is matched positionally *and* by name. Positional alone would
 * silently attach the id for item 3 to item 4 when the two executions disagreed
 * about a list; named alone could not tell two writes of the same iterating step
 * apart. A disagreement is refused rather than patched over, because an id
 * adopted against a different write than the one it names is a silent identity
 * swap — strictly worse than never having supplied it.
 */
describe("a manifest that does not describe the planned writes", () => {
  const MISMATCH = "ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH";

  async function refusedCreateBand(
    recordIds: AuthorityCommandRecordId[],
    operationId: string,
  ): Promise<{ outcome: AuthorityOutcome; storage: InMemoryObjectStorageBackend }> {
    const { authority, storage } = startAuthority();
    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId,
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Lambdas" },
      recordIds,
    });
    return { outcome, storage };
  }

  it("refuses a manifest naming a step the command does not plan there", async () => {
    const { outcome, storage } = await refusedCreateBand(
      [
        { step: "createBand", objectName: "Band", recordId: "band-lambdas" },
        // The command's second create is `createFounderMembership`. A device that
        // disagrees about the steps disagrees about the command.
        { step: "createFounderMembership_v2", objectName: "BandMember", recordId: "member-l" },
      ],
      "op-wrong-step",
    );

    expect(rejection(outcome).code).toBe(MISMATCH);
    expect(await storedIds(storage, "Band")).toEqual([]);
    expect(await storedIds(storage, "BandMember")).toEqual([]);
  });

  it("refuses a manifest with more entries than the command plans writes", async () => {
    const { outcome, storage } = await refusedCreateBand(
      [
        ...createBandManifest("band-lambdas", "member-lambdas"),
        // An extra entry is the same disagreement as a mismatched one: this
        // execution planned two creates and the device claims three.
        { step: "createFounderMembership", objectName: "BandMember", recordId: "member-extra" },
      ],
      "op-too-long",
    );

    expect(rejection(outcome).code).toBe(MISMATCH);
    expect(await storedIds(storage, "Band")).toEqual([]);
  });

  it("refuses a manifest with fewer entries than the command plans writes", async () => {
    const { outcome, storage } = await refusedCreateBand(
      [{ step: "createBand", objectName: "Band", recordId: "band-lambdas" }],
      "op-too-short",
    );

    expect(rejection(outcome).code).toBe(MISMATCH);
    // The refusal must arrive before the command commits, not after the step the
    // manifest did cover has already landed.
    expect(await storedIds(storage, "Band")).toEqual([]);
  });

  it("refuses a manifest whose item indexes do not match the iteration", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-skewed",
      "The Mus",
      "band-mus",
      "member-mus",
    );

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-skewed-items",
      kind: "command",
      commandName: "ImportSongs",
      input: { Band: bandId, Songs: [{ Title: "One" }, { Title: "Two" }, { Title: "Three" }] },
      // Right step, right object, right length — and item 1 is named twice while
      // item 2 is never named. This is precisely the case positional matching
      // alone would accept, handing song two the id meant for song three.
      recordIds: [
        { step: "importSongs", itemIndex: 0, objectName: "Song", recordId: "song-a" },
        { step: "importSongs", itemIndex: 1, objectName: "Song", recordId: "song-b" },
        { step: "importSongs", itemIndex: 1, objectName: "Song", recordId: "song-c" },
      ],
      selectedContexts: { Band: bandId },
    });

    expect(rejection(outcome).code).toBe(MISMATCH);
    expect(await storedIds(storage, "Song")).toEqual([]);
  });

  it("refuses a command intent with no manifest rather than minting ids server-side", async () => {
    const { authority, storage } = startAuthority();

    // The cast is the point of the case: `recordIds` is required by the type, so
    // the only way here is a caller that ignores the contract — a stale client, a
    // hand-rolled request, or a future refactor that makes the field optional
    // "for compatibility". Falling back to server-minted ids would return records
    // for rows the device does not have and look like success.
    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-no-manifest",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Nus" },
    } as unknown as AuthorityOperationIntent);

    expect(rejection(outcome).code).toBe(MISMATCH);
    expect(await storedIds(storage, "Band")).toEqual([]);
    expect(await storedIds(storage, "BandMember")).toEqual([]);
  });
});

/**
 * Idempotency is keyed on the operation id and covers the whole command. A
 * command is one operation however many records it writes, so a retry after a
 * lost response must return the stored outcome rather than re-executing — and
 * re-executing would not merely duplicate, it would be refused as a collision on
 * its own manifest, which reads to the user as a failure of work that succeeded.
 */
describe("replaying the same command twice", () => {
  it("returns the stored outcome and writes nothing a second time", async () => {
    const { authority, storage } = startAuthority();
    const intent: AuthorityOperationIntent = {
      operationId: "op-retried-band",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Xis" },
      recordIds: createBandManifest("band-xis", "member-xis"),
    };

    const first = await authority.replay(SESSION_TOKEN, intent);
    const second = await authority.replay(SESSION_TOKEN, intent);

    expect(second).toEqual(first);
    expect(acceptedRecords(second).map((record) => record.meta.guid)).toEqual([
      "band-xis",
      "member-xis",
    ]);
    // One band, one membership, and the revision unchanged by the retry.
    expect(await storedIds(storage, "Band")).toEqual(["band-xis"]);
    expect(await storedIds(storage, "BandMember")).toEqual(["member-xis"]);
    expect(acceptedRecords(second)[0]?.meta.revision).toBe(
      acceptedRecords(first)[0]?.meta.revision,
    );
  });

  it("writes every item of an iterating step once, not once per attempt", async () => {
    const { authority, storage } = startAuthority();
    const bandId = await establishBand(
      authority,
      "op-band-for-retry",
      "The Omicrons",
      "band-omicrons",
      "member-omicrons",
    );
    const intent: AuthorityOperationIntent = {
      operationId: "op-retried-import",
      kind: "command",
      commandName: "ImportSongs",
      input: { Band: bandId, Songs: [{ Title: "One" }, { Title: "Two" }] },
      recordIds: importSongsManifest(["song-r1", "song-r2"]),
      selectedContexts: { Band: bandId },
    };

    const first = await authority.replay(SESSION_TOKEN, intent);
    const second = await authority.replay(SESSION_TOKEN, intent);

    expect(second).toEqual(first);
    expect(await storedIds(storage, "Song")).toEqual(["song-r1", "song-r2"]);
  });
});

/**
 * Phase 71's command READ step re-executes at the authority exactly like every
 * other step: it is not merely trusted from the device. The read policy below
 * (`match: "owner"`) is enforced against the *authority's own copy* of the
 * record and the *session-verified* caller, so a client cannot embed a read it
 * was not entitled to make and have the authority accept it.
 */
describe("authority replay of a command with a READ step", () => {
  const FOUNDER_TOKEN = "read-step-founder-token-read-step-founder";
  const STRANGER_TOKEN = "read-step-stranger-token-read-step-strang";

  function duplicateEventPartialModel(): PartialApplicationModel {
    return {
      app: { name: "CommandReadStepAuthorityDemo" },
      roles: [],
      objects: [
        {
          name: "Event",
          businessKey: "VenueName",
          displayField: "VenueName",
          fields: [
            { name: "VenueName", type: "text", required: true },
            { name: "EventDate", type: "date", required: true },
          ],
        },
      ],
      commands: [
        {
          name: "DuplicateEvent",
          inputs: [
            { name: "SourceEventId", type: "text", required: true },
            { name: "NewDate", type: "date", required: true },
          ],
          steps: [
            {
              name: "source",
              action: "read",
              object: "Event",
              recordId: { kind: "input", name: "SourceEventId" },
            },
            {
              name: "duplicate",
              action: "create",
              object: "Event",
              authority: "command",
              values: {
                VenueName: { kind: "stepField", step: "source", field: "VenueName" },
                EventDate: { kind: "input", name: "NewDate" },
              },
            },
          ],
        },
      ],
      policies: [
        {
          name: "EventPolicy",
          object: "Event",
          rules: [
            {
              name: "allowAuthenticatedCreateEvent",
              effect: "allow",
              principal: { match: "authenticated" },
              action: "create",
            },
            // Only the record's own creator may read it — the same gate the
            // command's READ step must be caught by, since the authority never
            // grants a global role (`resolveContext` always resolves `roles: []`).
            {
              name: "allowOwnerReadEvent",
              effect: "allow",
              principal: { match: "owner" },
              action: "read",
            },
          ],
        },
      ],
    };
  }

  function startReadStepAuthority() {
    const model = resolveApplicationModel(duplicateEventPartialModel());
    const storage = new InMemoryObjectStorageBackend();
    const sessions = new StaticSessionAdapter(
      new Map([
        [FOUNDER_TOKEN, { userId: "user-founder" }],
        [STRANGER_TOKEN, { userId: "user-stranger" }],
      ]),
    );
    return { authority: new AuthorityService(model, storage, sessions), storage };
  }

  it("re-executes the READ step and the write it seeds in one transaction", async () => {
    const { authority, storage } = startReadStepAuthority();
    const source = await authority.replay(FOUNDER_TOKEN, {
      operationId: "op-read-step-source",
      kind: "create",
      objectName: "Event",
      recordId: "event-source",
      values: { VenueName: "The Forum", EventDate: "2026-01-10" },
    });
    const sourceRecord = acceptedRecords(source)[0];
    expect(sourceRecord?.meta.guid).toBe("event-source");

    const outcome = await authority.replay(FOUNDER_TOKEN, {
      operationId: "op-read-step-duplicate",
      kind: "command",
      commandName: "DuplicateEvent",
      input: { SourceEventId: "event-source", NewDate: "2026-03-20" },
      // The READ step writes nothing, so the manifest names only the create.
      recordIds: [{ step: "duplicate", objectName: "Event", recordId: "event-duplicate" }],
    });

    const records = acceptedRecords(outcome);
    expect(records).toHaveLength(1);
    expect(records[0]?.meta.guid).toBe("event-duplicate");
    expect(records[0]?.values).toMatchObject({ VenueName: "The Forum", EventDate: "2026-03-20" });
    expect(await storedIds(storage, "Event")).toEqual(["event-duplicate", "event-source"]);
  });

  it("rejects the whole command when the caller's read policy denies the READ step", async () => {
    const { authority, storage } = startReadStepAuthority();
    await authority.replay(FOUNDER_TOKEN, {
      operationId: "op-read-step-denied-source",
      kind: "create",
      objectName: "Event",
      recordId: "event-owned-by-founder",
      values: { VenueName: "The Forum", EventDate: "2026-01-10" },
    });

    // A stranger's client could claim it already read this record, but the
    // authority re-reads it itself under the stranger's own session — and
    // `owner` denies anyone but the founder.
    const outcome = await authority.replay(STRANGER_TOKEN, {
      operationId: "op-read-step-denied-duplicate",
      kind: "command",
      commandName: "DuplicateEvent",
      input: { SourceEventId: "event-owned-by-founder", NewDate: "2026-03-20" },
      recordIds: [{ step: "duplicate", objectName: "Event", recordId: "event-should-not-exist" }],
    });

    expect(rejection(outcome).code).toBe("ADL_POLICY_DENIED");
    expect(await storedIds(storage, "Event")).toEqual(["event-owned-by-founder"]);
  });

  it("rejects the whole command when the READ step's target record does not exist", async () => {
    const { authority, storage } = startReadStepAuthority();

    const outcome = await authority.replay(FOUNDER_TOKEN, {
      operationId: "op-read-step-missing",
      kind: "command",
      commandName: "DuplicateEvent",
      input: { SourceEventId: "no-such-event", NewDate: "2026-03-20" },
      recordIds: [{ step: "duplicate", objectName: "Event", recordId: "event-should-not-exist" }],
    });

    expect(rejection(outcome).code).toBe("ADL_STORAGE_ERROR");
    expect(await storedIds(storage, "Event")).toEqual([]);
  });
});
