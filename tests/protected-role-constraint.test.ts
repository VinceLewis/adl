import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  RuntimeValidationError,
  resolveApplicationModel,
} from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

const fixedNow = new Date("2026-07-31T09:00:00.000Z");

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

/**
 * A generic, non-Band-specific membership model: any ADL app that shapes a
 * membership object with a privileged-role field can declare this constraint.
 * `roleValues` carries two guarded roles so a demotion *between* guarded
 * values can be told apart from a demotion *out of* the guarded set.
 */
function createProtectedRoleModel(
  options: { scopeFields?: string[]; roleValues?: string[]; minCount?: number } = {},
): PartialApplicationModel {
  return {
    app: { name: "ProtectedRoleDemo" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Team",
        businessKey: "Name",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "TeamMember",
        businessKey: "User",
        displayField: "User",
        fields: [
          {
            name: "Team",
            type: "text",
            required: true,
            lookup: { targetObject: "Team", displayField: "Name" },
          },
          { name: "User", type: "text", required: true },
          { name: "Role", type: "text", required: true },
          { name: "Note", type: "text" },
        ],
        constraints: [
          {
            name: "lastTeamAdminStanding",
            kind: "protectedRole",
            scopeFields: options.scopeFields ?? ["Team"],
            roleField: "Role",
            roleValues: options.roleValues ?? ["Admin"],
            ...(options.minCount === undefined ? {} : { minCount: options.minCount }),
          },
        ],
      },
    ],
    policies: [
      {
        name: "TeamPolicy",
        object: "Team",
        rules: [
          {
            name: "allowAdminTeam",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
      {
        name: "TeamMemberPolicy",
        object: "TeamMember",
        rules: [
          {
            name: "allowAdminTeamMember",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  };
}

function createProtectedRoleRuntime(
  options: Parameters<typeof createProtectedRoleModel>[0] = {},
): ApplicationRuntime {
  return new ApplicationRuntime(resolveApplicationModel(createProtectedRoleModel(options)));
}

describe("protected role constraint (last admin standing)", () => {
  it("refuses deleting the last privileged-role holder in scope", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );

    await expect(
      runtime.delete("TeamMember", founder.meta.guid, adminContext),
    ).rejects.toMatchObject({
      name: "RuntimeValidationError",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_CONSTRAINT_PROTECTED_ROLE" })],
    });
  });

  it("refuses demoting the last privileged-role holder out of the guarded set", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );

    await expect(
      runtime.update("TeamMember", founder.meta.guid, { Role: "Member" }, adminContext),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("allows deleting a privileged-role holder when another remains in the same scope", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );
    await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "riley", Role: "Admin" },
      adminContext,
    );

    await expect(
      runtime.delete("TeamMember", founder.meta.guid, adminContext),
    ).resolves.toBeDefined();
  });

  it("allows demoting a privileged-role holder when another remains in the same scope", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );
    await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "riley", Role: "Admin" },
      adminContext,
    );

    const demoted = await runtime.update(
      "TeamMember",
      founder.meta.guid,
      { Role: "Member" },
      adminContext,
    );
    expect(demoted.values.Role).toBe("Member");
  });

  it("never blocks a write on a record that never held the guarded role", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    // No admin at all in this team's scope — a pre-existing state the
    // constraint does not retroactively repair.
    const member = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Member" },
      adminContext,
    );

    await expect(
      runtime.delete("TeamMember", member.meta.guid, adminContext),
    ).resolves.toBeDefined();
  });

  it("leaves an update to an unrelated field on the sole admin unaffected", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );

    const updated = await runtime.update(
      "TeamMember",
      founder.meta.guid,
      { Note: "Founding member" },
      adminContext,
    );
    expect(updated.values.Note).toBe("Founding member");
  });

  it("scopes the guard per scope key, so one team's last admin does not affect another's", async () => {
    const runtime = createProtectedRoleRuntime();
    const alpha = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const beta = await runtime.create("Team", { Name: "Beta" }, adminContext);
    const alphaAdmin = await runtime.create(
      "TeamMember",
      { Team: alpha.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );
    const betaAdmin = await runtime.create(
      "TeamMember",
      { Team: beta.meta.guid, User: "riley", Role: "Admin" },
      adminContext,
    );

    await expect(
      runtime.delete("TeamMember", alphaAdmin.meta.guid, adminContext),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
    // Beta's own last admin is untouched by Alpha's refused delete.
    await expect(
      runtime.delete("TeamMember", betaAdmin.meta.guid, adminContext),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("treats a demotion between two guarded roles as still satisfying the guard", async () => {
    const runtime = createProtectedRoleRuntime({ roleValues: ["Admin", "Owner"] });
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const founder = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );

    const demoted = await runtime.update(
      "TeamMember",
      founder.meta.guid,
      { Role: "Owner" },
      adminContext,
    );
    expect(demoted.values.Role).toBe("Owner");
  });

  it("refuses a create-time count from ever satisfying a delete that drops below minCount 2", async () => {
    const runtime = createProtectedRoleRuntime({ minCount: 2 });
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    const first = await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "casey", Role: "Admin" },
      adminContext,
    );
    await runtime.create(
      "TeamMember",
      { Team: team.meta.guid, User: "riley", Role: "Admin" },
      adminContext,
    );

    // Exactly two admins exist, and minCount is two, so removing either one
    // would leave one — below the declared minimum.
    await expect(
      runtime.delete("TeamMember", first.meta.guid, adminContext),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("never fires for a create, which can only add a record", async () => {
    const runtime = createProtectedRoleRuntime();
    const team = await runtime.create("Team", { Name: "Alpha" }, adminContext);
    await expect(
      runtime.create(
        "TeamMember",
        { Team: team.meta.guid, User: "casey", Role: "Member" },
        adminContext,
      ),
    ).resolves.toBeDefined();
  });
});
