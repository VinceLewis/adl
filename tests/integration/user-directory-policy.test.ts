import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  PolicyDeniedError,
  PostgresObjectStorageBackend,
} from "../../src/index.js";
import type { ResolvedApplicationModel, RuntimeContext } from "../../src/index.js";
import {
  createGiggleBandExampleModel,
  seedBandReferenceRuntime,
  bandReferenceSystemContext,
} from "../../src/reference/band-app.js";
import {
  createJointlyReferenceModel,
  seedJointlyReferenceRuntime,
  jointlyReferenceSystemContext,
} from "../../src/reference/jointly-app.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 101, against real PostgreSQL because policy enforcement is an
 * authority-side claim and `AGENTS.md` will not accept a fake for one.
 *
 * Both reference apps used to grant `SEARCH` and `READ` on the whole `User`
 * object to any `AUTHENTICATED` caller, with `Email` a required field on
 * `User` in both. Self-service registration (Phase 99) turns that into an open
 * directory of every user's name and email, so the grant is now field-scoped to
 * the display field alone. These tests drive the same `ObjectStore` and
 * `ReadModelService` the authority runs, over the real projection tables rather
 * than an in-memory store, and assert both halves: the refusals are real, and
 * the labels that made the original widening necessary still resolve.
 */

const bandApp = "phase-101-band";
const jointlyApp = "phase-101-jointly";

let pool: Pool;
let bandModel: ResolvedApplicationModel;
let jointlyModel: ResolvedApplicationModel;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  bandModel = await createGiggleBandExampleModel();
  jointlyModel = await createJointlyReferenceModel();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, bandApp, bandModel.modelVersion);
  await seedApplication(pool, jointlyApp, jointlyModel.modelVersion);
});

function runtimeFor(model: ResolvedApplicationModel, applicationId: string): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
}

describe("Giggle Band's User directory over real PostgreSQL", () => {
  it("gives a band member a name and refuses the record, the email and the directory", async () => {
    const runtime = runtimeFor(bandModel, bandApp);
    const seeded = await seedBandReferenceRuntime(runtime, bandReferenceSystemContext);

    // The label the whole widening existed to keep working, read back through
    // the field-scoped path both browser surfaces and the read-model resolver
    // now use.
    const label = await runtime.readFieldsForDisplay(
      "User",
      seeded.guest.meta.guid,
      ["Name", "Email"],
      seeded.firstBandContext,
    );
    expect(label?.values).toEqual({ Name: "Riley Stone" });

    await expect(
      runtime.read("User", seeded.guest.meta.guid, seeded.firstBandContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(runtime.search("User", undefined, seeded.firstBandContext)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );

    // A signed-in caller who is in no band at all is in exactly the same
    // position — which is the point, now that anyone may sign themselves up.
    const stranger: RuntimeContext = {
      userId: "self-registered-stranger",
      roles: [],
      channel: "api",
      now: new Date("2026-08-15T09:00:00.000Z"),
    };
    await expect(runtime.read("User", seeded.guest.meta.guid, stranger)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
    await expect(runtime.search("User", undefined, stranger)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );

    // And `SystemAdmin` keeps everything, through `UserSystemAdminPolicy`.
    const adminView = await runtime.read(
      "User",
      seeded.guest.meta.guid,
      bandReferenceSystemContext,
    );
    expect(adminView?.values.Email).toBe("riley@example.com");
  });

  it("still resolves availability-board member names from the read model", async () => {
    const runtime = runtimeFor(bandModel, bandApp);
    const seeded = await seedBandReferenceRuntime(runtime, bandReferenceSystemContext);

    const roster = await runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.firstBandContext,
    );

    expect(roster.rows.length).toBeGreaterThan(0);
    expect(roster.rows.map((row) => row.display?.Member)).toContain("Casey Morgan");
    expect(JSON.stringify(roster.rows)).not.toContain("@example.com");
  });
});

describe("Jointly Care's User directory over real PostgreSQL", () => {
  it("gives a circle member a display name and refuses the record, the email and the directory", async () => {
    const runtime = runtimeFor(jointlyModel, jointlyApp);
    const seeded = await seedJointlyReferenceRuntime(runtime, jointlyReferenceSystemContext);

    const label = await runtime.readFieldsForDisplay(
      "User",
      seeded.coCarer.meta.guid,
      ["DisplayName", "Email", "Timezone"],
      seeded.firstCircleContext,
    );
    expect(label?.values).toEqual({ DisplayName: "Sam Rivera" });

    await expect(
      runtime.read("User", seeded.coCarer.meta.guid, seeded.firstCircleContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(
      runtime.search("User", undefined, seeded.firstCircleContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const adminView = await runtime.read(
      "User",
      seeded.coCarer.meta.guid,
      jointlyReferenceSystemContext,
    );
    expect(adminView?.values.Email).toBe("sam@example.com");
  });

  it("renders the circle roster by display name, with no email anywhere in it", async () => {
    const runtime = runtimeFor(jointlyModel, jointlyApp);
    const seeded = await seedJointlyReferenceRuntime(runtime, jointlyReferenceSystemContext);

    const roster = await runtime.executeReadModel("CircleMemberRoster", seeded.firstCircleContext);

    expect(roster.rows.map((row) => row.display?.Member).sort()).toEqual(
      ["Jordan Casey", "Sam Rivera"].sort(),
    );
    expect(JSON.stringify(roster.rows)).not.toContain("@example.com");
  });
});
