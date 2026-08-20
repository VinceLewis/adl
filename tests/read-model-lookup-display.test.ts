import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  PartialApplicationModel,
  PartialPolicyModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

const fixedNow = new Date("2026-07-07T08:00:00.000Z");

/*
 * Phase 91. A read-model field projected `FROM <source>.<lookupField>` used to
 * lose the source field's `LOOKUP ... DISPLAY` entirely, so every
 * read-model-backed surface rendered the stored record id where the *same*
 * value rendered as a name on an object-backed surface. The projected field now
 * carries the lookup, and `ReadModelService` resolves it through the same gates
 * a source record clears — which is the half that must not regress: a label the
 * caller's policy forbids has to become the raw id again, never a name.
 */
describe("read model lookup display resolution", () => {
  describe("resolved model", () => {
    it("carries the source field's lookup onto the projected field", () => {
      const model = resolveApplicationModel(createLookupDisplayPartialModel());
      const roster = (model.readModels ?? []).find((readModel) => readModel.name === "TeamRoster");

      expect(roster?.fields.find((field) => field.name === "Member")?.lookup).toEqual({
        targetObject: "User",
        displayField: "Name",
      });
      // `TARGET_FIELD` travels with it: the runtime needs to know the stored
      // value is a natural key, not a record id.
      const gadgets = (model.readModels ?? []).find(
        (readModel) => readModel.name === "GadgetOwners",
      );
      expect(gadgets?.fields.find((field) => field.name === "Owner")?.lookup).toEqual({
        targetObject: "User",
        targetField: "Email",
        displayField: "Name",
      });
    });

    it("leaves fields with nothing to resolve without a lookup", () => {
      const model = resolveApplicationModel(createLookupDisplayPartialModel());
      const roster = (model.readModels ?? []).find((readModel) => readModel.name === "TeamRoster");

      // A plain projected field, and an expression field that computes a new
      // value rather than projecting one.
      expect(roster?.fields.find((field) => field.name === "Role")?.lookup).toBeUndefined();
      expect(roster?.fields.find((field) => field.name === "Caller")?.lookup).toBeUndefined();
    });

    it("accepts a model whose derived lookup agrees with the projection", () => {
      expect(
        validateApplicationModel(resolveApplicationModel(createLookupDisplayPartialModel())),
      ).toEqual([]);
    });

    it("reports a resolved model whose projected lookup disagrees with the source field", () => {
      // Only reachable for a resolved model built outside the compiler — which
      // `ApplicationRuntime` accepts and validates. A compiled model copies the
      // lookup verbatim and can never disagree.
      const model = resolveApplicationModel(createLookupDisplayPartialModel());
      const roster = (model.readModels ?? []).find((readModel) => readModel.name === "TeamRoster");
      const member = roster?.fields.find((field) => field.name === "Member");
      if (member === undefined) {
        throw new Error("TeamRoster is missing its Member field.");
      }
      member.lookup = { targetObject: "Team", displayField: "Name" };

      expect(validateApplicationModel(model)).toEqual([
        expect.objectContaining({
          code: "ADL_READ_MODEL_FIELD_LOOKUP_MISMATCH",
          severity: "error",
        }),
      ]);
    });

    it("reports a projected lookup on a field that projects no lookup at all", () => {
      const model = resolveApplicationModel(createLookupDisplayPartialModel());
      const roster = (model.readModels ?? []).find((readModel) => readModel.name === "TeamRoster");
      const role = roster?.fields.find((field) => field.name === "Role");
      if (role === undefined) {
        throw new Error("TeamRoster is missing its Role field.");
      }
      role.lookup = { targetObject: "User", displayField: "Name" };

      expect(validateApplicationModel(model)).toEqual([
        expect.objectContaining({ code: "ADL_READ_MODEL_FIELD_LOOKUP_MISMATCH" }),
      ]);
    });
  });

  describe("runtime resolution", () => {
    it("resolves a projected lookup to the target's display value", async () => {
      const seeded = await createSeededLookupDisplayRuntime();

      const result = await seeded.runtime.executeReadModel("TeamRoster", seeded.teamContext);

      expect(result.rows.map((row) => row.display?.Member)).toEqual(["Casey Morgan", "Robin Fox"]);
    });

    it("leaves the stored value untouched so filters, sorts and actions still see it", async () => {
      const seeded = await createSeededLookupDisplayRuntime();

      const result = await seeded.runtime.executeReadModel("TeamRoster", seeded.teamContext);

      expect(result.rows.map((row) => row.values.Member)).toEqual([
        seeded.casey.meta.guid,
        seeded.robin.meta.guid,
      ]);
      // Nothing is invented for a field that projects no lookup.
      expect(result.rows[0]?.display).toEqual({ Member: "Casey Morgan" });
    });

    it("resolves a TARGET_FIELD lookup by matching the natural key", async () => {
      const seeded = await createSeededLookupDisplayRuntime();

      const result = await seeded.runtime.executeReadModel("GadgetOwners", seeded.teamContext);

      expect(result.rows.map((row) => [row.values.Owner, row.display?.Owner])).toEqual([
        ["casey@example.com", "Casey Morgan"],
        // No user carries this address, so there is nothing to resolve.
        ["nobody@example.com", undefined],
      ]);
    });

    it("degrades to the raw id when the lookup target does not exist", async () => {
      const seeded = await createSeededLookupDisplayRuntime();
      await seeded.runtime.delete("User", seeded.robin.meta.guid, seeded.systemContext);

      const result = await seeded.runtime.executeReadModel("TeamRoster", seeded.teamContext);
      const robinRow = result.rows.find((row) => row.values.Member === seeded.robin.meta.guid);

      expect(robinRow).toBeDefined();
      expect(robinRow?.display?.Member).toBeUndefined();
      expect(robinRow?.values.Member).toBe(seeded.robin.meta.guid);
    });

    it("degrades to the raw id when the caller may not read the lookup target", async () => {
      // The criterion that must not be skipped: a display label is a record
      // read, so a viewer denied that record sees the id they already hold, not
      // a name they are not entitled to.
      const seeded = await createSeededLookupDisplayRuntime(
        createLookupDisplayPartialModel({ denyUserRead: true }),
      );

      const result = await seeded.runtime.executeReadModel("TeamRoster", seeded.teamContext);

      expect(result.rows.length).toBe(2);
      expect(result.rows.map((row) => row.display)).toEqual([undefined, undefined]);
      expect(result.rows.map((row) => row.values.Member)).toEqual([
        seeded.casey.meta.guid,
        seeded.robin.meta.guid,
      ]);
    });

    it("degrades to the raw id when read shaping hides the display field", async () => {
      // Row-level `read` is allowed here; the *field* is not. Reading around a
      // field-level `HIDE` would be the same leak by a narrower door.
      const seeded = await createSeededLookupDisplayRuntime(
        createLookupDisplayPartialModel({ hideUserName: true }),
      );

      const result = await seeded.runtime.executeReadModel("TeamRoster", seeded.teamContext);

      expect(result.rows.map((row) => row.display?.Member)).toEqual([undefined, undefined]);
    });

    it("degrades to the raw natural key when the caller may not search the target object", async () => {
      // Matching by field value is a search however it is spelled, so a caller
      // who may not enumerate `User` must not be able to fish names out of it
      // one label at a time.
      const seeded = await createSeededLookupDisplayRuntime(
        createLookupDisplayPartialModel({ denyUserSearch: true }),
      );

      const result = await seeded.runtime.executeReadModel("GadgetOwners", seeded.teamContext);

      expect(result.rows.map((row) => row.display?.Owner)).toEqual([undefined, undefined]);
      expect(result.rows[0]?.values.Owner).toBe("casey@example.com");
    });
  });

  describe("presentation", () => {
    it("renders the resolved label in a read-model-backed row", async () => {
      const seeded = await createSeededLookupDisplayRuntime();

      const view = await seeded.runtime.evaluatePresentationView(
        "TeamMember",
        "RosterBoard",
        seeded.teamContext,
      );

      expect(view.diagnostics).toEqual([]);
      expect(view.sections[0]?.lists[0]?.rows[0]?.fragments).toEqual([
        { kind: "text", text: "Casey Morgan", style: "bold" },
        { kind: "text", text: " - ", style: "plain" },
        { kind: "text", text: "Owner", style: "plain" },
      ]);
    });

    it("renders the raw id in a read-model-backed row when the target is denied", async () => {
      const seeded = await createSeededLookupDisplayRuntime(
        createLookupDisplayPartialModel({ denyUserRead: true }),
      );

      const view = await seeded.runtime.evaluatePresentationView(
        "TeamMember",
        "RosterBoard",
        seeded.teamContext,
      );

      expect(view.diagnostics).toEqual([]);
      expect(view.sections[0]?.lists[0]?.rows[0]?.fragments[0]).toEqual({
        kind: "text",
        text: seeded.casey.meta.guid,
        style: "bold",
      });
    });
  });
});

interface SeededLookupDisplayRuntime {
  runtime: ApplicationRuntime;
  systemContext: RuntimeContext;
  teamContext: RuntimeContext;
  casey: StoredObjectRecord;
  robin: StoredObjectRecord;
  team: StoredObjectRecord;
}

async function createSeededLookupDisplayRuntime(
  partialModel: PartialApplicationModel = createLookupDisplayPartialModel(),
): Promise<SeededLookupDisplayRuntime> {
  const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel));
  const systemContext: RuntimeContext = {
    userId: "system-admin",
    roles: ["SystemAdmin"],
    channel: "api",
    now: fixedNow,
  };

  const casey = await runtime.create(
    "User",
    { Name: "Casey Morgan", Email: "casey@example.com" },
    systemContext,
  );
  const robin = await runtime.create(
    "User",
    { Name: "Robin Fox", Email: "robin@example.com" },
    systemContext,
  );
  const team = await runtime.create("Team", { Name: "The Alphas" }, systemContext);
  const teamSystemContext: RuntimeContext = {
    ...systemContext,
    selectedContexts: { Team: team.meta.guid },
  };

  await runtime.create(
    "TeamMember",
    { User: casey.meta.guid, Team: team.meta.guid, Role: "Owner" },
    teamSystemContext,
  );
  await runtime.create(
    "TeamMember",
    { User: robin.meta.guid, Team: team.meta.guid, Role: "Member" },
    teamSystemContext,
  );
  await runtime.create("Gadget", { Label: "Amp", Owner: "casey@example.com" }, teamSystemContext);
  await runtime.create(
    "Gadget",
    { Label: "Orphan", Owner: "nobody@example.com" },
    teamSystemContext,
  );

  const caseyBase: RuntimeContext = {
    userId: casey.meta.guid,
    roles: [],
    channel: "api",
    now: fixedNow,
  };

  return {
    runtime,
    systemContext,
    teamContext: await runtime.withSelectedContext("Team", team.meta.guid, caseyBase),
    casey,
    robin,
    team,
  };
}

interface LookupDisplayModelOptions {
  denyUserRead?: boolean;
  denyUserSearch?: boolean;
  hideUserName?: boolean;
}

function createLookupDisplayPartialModel(
  options: LookupDisplayModelOptions = {},
): PartialApplicationModel {
  return {
    app: { name: "ReadModelLookupDisplay", startView: "RosterBoard" },
    roles: [{ name: "SystemAdmin" }, { name: "Member" }, { name: "Owner", inherits: ["Member"] }],
    contexts: [
      {
        name: "Team",
        selection: { mode: "optional" },
        membership: {
          object: "TeamMember",
          userField: "User",
          contextField: "Team",
          roleField: "Role",
          roles: ["Owner", "Member"],
        },
      },
    ],
    objects: [
      {
        name: "User",
        businessKey: "Email",
        displayField: "Name",
        fields: [
          { name: "Name", type: "text", required: true },
          { name: "Email", type: "text", required: true, validators: [{ kind: "email" }] },
        ],
      },
      {
        name: "Team",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "TeamMember",
        scope: { context: "Team", field: "Team" },
        fields: [
          {
            name: "User",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          {
            name: "Team",
            type: "text",
            required: true,
            lookup: { targetObject: "Team", displayField: "Name" },
          },
          { name: "Role", type: "text", required: true },
        ],
        views: [
          {
            name: "RosterBoard",
            kind: "dashboard",
            readModel: "TeamRoster",
            fields: ["Member", "Role"],
            presentation: {
              sections: [
                {
                  name: "Roster",
                  lists: [
                    {
                      name: "RosterList",
                      sourceKind: "readModel",
                      source: "TeamRoster",
                      fields: ["Member", "Role"],
                      row: {
                        fragments: [
                          { kind: "field", field: "Member", style: "bold" },
                          { kind: "text", text: " - " },
                          { kind: "field", field: "Role" },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        name: "Gadget",
        displayField: "Label",
        fields: [
          { name: "Label", type: "text", required: true },
          {
            // A natural-key lookup: the stored value is the target's `Email`,
            // never its record id.
            name: "Owner",
            type: "text",
            required: true,
            lookup: { targetObject: "User", targetField: "Email", displayField: "Name" },
          },
        ],
      },
    ],
    readModels: [
      {
        name: "TeamRoster",
        context: { mode: "required", context: "Team" },
        sources: [{ name: "member", object: "TeamMember", scope: "currentContext" }],
        fields: [
          { name: "Member", source: "member", field: "User" },
          { name: "Role", source: "member", field: "Role" },
          { name: "Caller", type: "text", expression: { kind: "runtime", property: "userId" } },
        ],
        // Descending puts `Owner` (Casey) before `Member` (Robin), which keeps
        // the row order deterministic without sorting on a record id.
        sort: [{ field: "Role", direction: "desc" }],
      },
      {
        name: "GadgetOwners",
        sources: [{ name: "gadget", object: "Gadget", scope: "all" }],
        fields: [
          { name: "Label", source: "gadget", field: "Label" },
          { name: "Owner", source: "gadget", field: "Owner" },
        ],
        sort: [{ field: "Label", direction: "asc" }],
      },
    ],
    policies: [
      createUserPolicy(options),
      createOpenPolicy("Team"),
      createOpenPolicy("TeamMember"),
      createOpenPolicy("Gadget"),
    ],
  };
}

function createUserPolicy(options: LookupDisplayModelOptions): PartialPolicyModel {
  return {
    name: "UserPolicy",
    object: "User",
    rules: [
      {
        name: "allowSystemAdminAllUserOps",
        effect: "allow",
        principal: { match: "specific", roles: ["SystemAdmin"] },
        action: "*",
      },
      ...(options.denyUserSearch === true
        ? []
        : [
            {
              name: "allowSearchUser",
              effect: "allow" as const,
              principal: { match: "authenticated" as const },
              action: "search" as const,
            },
          ]),
      ...(options.denyUserRead === true
        ? []
        : [
            {
              name: "allowReadUser",
              effect: "allow" as const,
              principal: { match: "authenticated" as const },
              action: "read" as const,
            },
          ]),
      ...(options.hideUserName === true
        ? [
            {
              name: "hideUserName",
              effect: "hidden" as const,
              principal: { match: "authenticated" as const },
              action: "read" as const,
              fields: ["Name"],
            },
          ]
        : []),
    ],
  };
}

function createOpenPolicy(objectName: string): PartialPolicyModel {
  return {
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: `allowSystemAdminAll${objectName}Ops`,
        effect: "allow",
        principal: { match: "specific", roles: ["SystemAdmin"] },
        action: "*",
      },
      {
        name: `allowAuthenticatedRead${objectName}`,
        effect: "allow",
        principal: { match: "authenticated" },
        action: "read",
      },
      {
        name: `allowAuthenticatedSearch${objectName}`,
        effect: "allow",
        principal: { match: "authenticated" },
        action: "search",
      },
    ],
  };
}
