import { describe, expect, it } from "vitest";
import {
  AuthorityService,
  InMemoryObjectStorageBackend,
  StaticSessionAdapter,
} from "../src/index.js";
import { createGiggleBandExampleModel } from "../src/ui/demo-fixture.js";
import type { AuthorityOutcome } from "../src/index.js";

/**
 * What the Phase 56 commands do when they reach the authority.
 *
 * Both new command shapes — a batch (`ImportSongs`) and one that creates a
 * business context together with its first membership (`CreateBand`) — depend on
 * every step landing in one transaction. This file pins where that guarantee
 * survives the sync boundary and where it does not, because the answer differs
 * by intent kind and the difference is invisible from the runtime alone.
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

describe("authority replay of context-establishing and batch commands", () => {
  it("accepts a command that creates a context and its first membership together", async () => {
    const { authority } = startAuthority();

    const outcome = await authority.replay(SESSION_TOKEN, {
      operationId: "op-create-band",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "The Alphas", Description: "Founded through the command" },
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
    const created = acceptedRecords(
      await authority.replay(SESSION_TOKEN, {
        operationId: "op-band-for-import",
        kind: "command",
        commandName: "CreateBand",
        input: { Name: "The Gammas" },
      }),
    );
    const bandId = created.find((record) => record.meta.object === "Band")?.meta.guid ?? "";

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
    const created = acceptedRecords(
      await authority.replay(SESSION_TOKEN, {
        operationId: "op-band-for-bad-import",
        kind: "command",
        commandName: "CreateBand",
        input: { Name: "The Deltas" },
      }),
    );
    const bandId = created.find((record) => record.meta.object === "Band")?.meta.guid ?? "";

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
