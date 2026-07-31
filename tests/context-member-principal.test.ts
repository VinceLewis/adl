import { beforeEach, describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  PolicyDeniedError,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  ObjectStorageBackend,
  ObjectStorageSearchRequest,
  PartialApplicationModel,
  PartialObjectModel,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const fixedNow = new Date("2026-07-31T09:00:00.000Z");

/**
 * Counts the full-store scan that membership resolution needs.
 *
 * `listRecords` is the only call `RuntimeContextService` uses to find membership
 * records without an index, so its count is a direct measure of whether the
 * runtime resolved a roster at all. Reads and writes never use it.
 */
class ScanCountingBackend implements ObjectStorageBackend {
  readonly supportsTransactions = true;
  listRecordsCalls = 0;

  private readonly delegate = new InMemoryObjectStorageBackend();

  create(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.delegate.create(objectName, record);
  }

  read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    return this.delegate.read(objectName, id);
  }

  update(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.delegate.update(objectName, record);
  }

  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    return this.delegate.delete(objectName, tombstone);
  }

  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    return this.delegate.search(request);
  }

  listRecords(): Promise<PersistedObjectRecord[]> {
    this.listRecordsCalls += 1;
    return this.delegate.listRecords();
  }

  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.delegate.readApplicationMetadata();
  }

  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    return this.delegate.writeApplicationMetadata(metadata);
  }
}

function contextForBand(context: RuntimeContext, bandId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: { ...(context.selectedContexts ?? {}), Band: bandId },
  };
}

const availabilityObject: PartialObjectModel = {
  name: "Availability",
  displayField: "Note",
  fields: [
    {
      name: "OwnerId",
      type: "text",
      required: true,
      lookup: { targetObject: "User", displayField: "Name" },
    },
    { name: "Note", type: "text", required: true },
  ],
};

function adminOnlyPolicies(objects: string[]) {
  return objects.map((object) => ({
    name: `${object}AdminPolicy`,
    object,
    rules: [
      {
        name: `allowSystemAdminAll${object}Ops`,
        effect: "allow" as const,
        principal: { match: "specific" as const, roles: ["SystemAdmin"] },
        action: "*" as const,
      },
    ],
  }));
}

/**
 * A model whose `Availability` object is readable by the record owner and by
 * anybody who shares a band with them, and by nobody else.
 */
function createContextMemberPartialModel(): PartialApplicationModel {
  return {
    ...bandContextPartialModel,
    roles: [{ name: "SystemAdmin" }, { name: "BandAdmin" }, { name: "BandMember" }],
    objects: [...bandContextPartialModel.objects, availabilityObject],
    policies: [
      ...adminOnlyPolicies(["User", "Band", "BandMember", "Gig"]),
      {
        name: "AvailabilityPolicy",
        object: "Availability",
        rules: [
          {
            name: "allowSystemAdminAllAvailabilityOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowAvailabilityOwnerAllOps",
            effect: "allow",
            principal: { match: "owner" },
            action: "*",
          },
          {
            name: "allowBandMemberReadAvailability",
            effect: "allow",
            principal: {
              match: "contextMember",
              contextMember: { context: "Band", field: "OwnerId" },
            },
            action: "read",
          },
          {
            // The object-level search gate is evaluated with no record, so it
            // cannot be the co-member rule: search reaches the roster through
            // the per-record read filter below, not through this check.
            name: "allowAuthenticatedSearchAvailability",
            effect: "allow",
            principal: { match: "authenticated" },
            action: "search",
          },
        ],
      },
    ],
  } satisfies PartialApplicationModel;
}

/** The same model with the co-member rules removed and nothing else changed. */
function createNoContextMemberPartialModel(): PartialApplicationModel {
  const partial = createContextMemberPartialModel();

  return {
    ...partial,
    policies: (partial.policies ?? []).map((policy) =>
      policy.object === "Availability"
        ? {
            ...policy,
            rules: (policy.rules ?? []).filter((rule) => rule.principal?.match !== "contextMember"),
          }
        : policy,
    ),
  };
}

interface SeededBand {
  runtime: ApplicationRuntime;
  storage: ScanCountingBackend;
  aliceContext: RuntimeContext;
  bobContext: RuntimeContext;
  carolContext: RuntimeContext;
  daveContext: RuntimeContext;
  aliceAvailability: StoredObjectRecord;
  daveAvailability: StoredObjectRecord;
  bobMembershipId: string;
  alphasId: string;
}

/**
 * Alice and Bob share The Alphas. Carol is in The Betas alone. Dave is in no
 * band at all and owns his own availability record.
 */
async function seedBandRuntime(
  partialModel: PartialApplicationModel = createContextMemberPartialModel(),
): Promise<SeededBand> {
  const storage = new ScanCountingBackend();
  const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel), { storage });
  await runtime.whenReady();

  const systemContext: RuntimeContext = {
    userId: "system-admin",
    roles: ["SystemAdmin"],
    channel: "api",
    now: fixedNow,
  };

  const alice = await runtime.create(
    "User",
    { Name: "Alice Adams", Email: "alice@example.com" },
    systemContext,
  );
  const bob = await runtime.create(
    "User",
    { Name: "Bob Brand", Email: "bob@example.com" },
    systemContext,
  );
  const carol = await runtime.create(
    "User",
    { Name: "Carol Chen", Email: "carol@example.com" },
    systemContext,
  );
  const dave = await runtime.create(
    "User",
    { Name: "Dave Doyle", Email: "dave@example.com" },
    systemContext,
  );

  const alphas = await runtime.create("Band", { Name: "The Alphas" }, systemContext);
  const betas = await runtime.create("Band", { Name: "The Betas" }, systemContext);

  await runtime.create(
    "BandMember",
    { User: alice.meta.guid, Band: alphas.meta.guid, Role: "BandAdmin" },
    contextForBand(systemContext, alphas.meta.guid),
  );
  const bobMembership = await runtime.create(
    "BandMember",
    { User: bob.meta.guid, Band: alphas.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, alphas.meta.guid),
  );
  await runtime.create(
    "BandMember",
    { User: carol.meta.guid, Band: betas.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, betas.meta.guid),
  );

  const aliceAvailability = await runtime.create(
    "Availability",
    { OwnerId: alice.meta.guid, Note: "Free on Fridays" },
    systemContext,
  );
  const daveAvailability = await runtime.create(
    "Availability",
    { OwnerId: dave.meta.guid, Note: "Free on Mondays" },
    systemContext,
  );

  const memberContext = (userId: string): RuntimeContext => ({
    userId,
    roles: [],
    channel: "api",
    now: fixedNow,
  });

  return {
    runtime,
    storage,
    aliceContext: memberContext(alice.meta.guid),
    bobContext: memberContext(bob.meta.guid),
    carolContext: memberContext(carol.meta.guid),
    daveContext: memberContext(dave.meta.guid),
    aliceAvailability,
    daveAvailability,
    bobMembershipId: bobMembership.meta.guid,
    alphasId: alphas.meta.guid,
  };
}

describe("contextMember policy principal", () => {
  let seeded: SeededBand;

  beforeEach(async () => {
    seeded = await seedBandRuntime();
  });

  it("lets a band member read a fellow member's record", async () => {
    const record = await seeded.runtime.read(
      "Availability",
      seeded.aliceAvailability.meta.guid,
      seeded.bobContext,
    );

    expect(record?.values.Note).toBe("Free on Fridays");
  });

  it("applies the same roster to a scoped search", async () => {
    const records = await seeded.runtime.search("Availability", {}, seeded.bobContext);

    expect(records.map((record) => record.values.Note)).toEqual(["Free on Fridays"]);
  });

  it("denies a user who shares no context with the record owner", async () => {
    await expect(
      seeded.runtime.read("Availability", seeded.aliceAvailability.meta.guid, seeded.carolContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("denies a user whose membership was revoked on the very next call", async () => {
    const systemContext: RuntimeContext = {
      userId: "system-admin",
      roles: ["SystemAdmin"],
      channel: "api",
      now: fixedNow,
    };

    await expect(
      seeded.runtime.read("Availability", seeded.aliceAvailability.meta.guid, seeded.bobContext),
    ).resolves.not.toBeNull();

    await seeded.runtime.delete(
      "BandMember",
      seeded.bobMembershipId,
      contextForBand(systemContext, seeded.alphasId),
    );

    await expect(
      seeded.runtime.read("Availability", seeded.aliceAvailability.meta.guid, seeded.bobContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("leaves the record owner's own access unaffected by membership", async () => {
    const aliceOwnRecord = await seeded.runtime.read(
      "Availability",
      seeded.aliceAvailability.meta.guid,
      seeded.aliceContext,
    );
    expect(aliceOwnRecord?.values.Note).toBe("Free on Fridays");

    // Dave belongs to no band, so his roster is empty and only the owner rule
    // can be answering here.
    const daveOwnRecord = await seeded.runtime.read(
      "Availability",
      seeded.daveAvailability.meta.guid,
      seeded.daveContext,
    );
    expect(daveOwnRecord?.values.Note).toBe("Free on Mondays");

    await expect(
      seeded.runtime.read("Availability", seeded.daveAvailability.meta.guid, seeded.bobContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("never resolves membership for a model that declares no such principal", async () => {
    const withoutPrincipal = await seedBandRuntime(createNoContextMemberPartialModel());
    withoutPrincipal.storage.listRecordsCalls = 0;

    await expect(
      withoutPrincipal.runtime.read(
        "Availability",
        withoutPrincipal.aliceAvailability.meta.guid,
        withoutPrincipal.bobContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const ownRecord = await withoutPrincipal.runtime.read(
      "Availability",
      withoutPrincipal.daveAvailability.meta.guid,
      withoutPrincipal.daveContext,
    );

    expect(ownRecord?.values.Note).toBe("Free on Mondays");
    expect(withoutPrincipal.storage.listRecordsCalls).toBe(0);
  });

  it("resolves membership for a model that does declare the principal", async () => {
    seeded.storage.listRecordsCalls = 0;

    await seeded.runtime.read(
      "Availability",
      seeded.aliceAvailability.meta.guid,
      seeded.bobContext,
    );

    expect(seeded.storage.listRecordsCalls).toBeGreaterThan(0);
  });

  it("keeps a roster the caller already supplied instead of resolving its own", async () => {
    seeded.storage.listRecordsCalls = 0;

    await expect(
      seeded.runtime.read("Availability", seeded.aliceAvailability.meta.guid, {
        ...seeded.bobContext,
        contextMembers: { Band: [] },
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    expect(seeded.storage.listRecordsCalls).toBe(0);
  });
});
