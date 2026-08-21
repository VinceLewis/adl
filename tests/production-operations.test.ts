import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authority recovery and least-privilege operational artifacts", () => {
  it("keeps all authority projections in the restore procedure and separates traffic from migration privileges", async () => {
    const [runbook, roles, migration] = await Promise.all([
      readFile("docs/operations/authority-production-runbook.md", "utf8"),
      readFile("src/server/migrations/roles.sql", "utf8"),
      readFile("src/server/migrations/0002_security_operations.sql", "utf8"),
    ]);
    for (const projection of [
      "accepted records",
      "model metadata",
      "memberships",
      "session/invite verifiers",
      "outcomes",
      "runtime audit",
      "access audit",
    ]) {
      expect(runbook).toContain(projection);
    }
    expect(roles).toContain("create role adl_migrator");
    expect(roles).toContain("create role adl_authority");
    expect(roles).toContain("revoke create on schema public from adl_authority");
    expect(migration).toContain("add primary key (operation_id, actor_id)");
  });

  it("keeps the traffic role's table grants in grants.sql, where adl_migrator can run them", async () => {
    // roles.sql is run by the database owner, which owns none of the projection
    // tables: a table grant there covers nothing, and `alter default privileges
    // for role adl_migrator` there is refused outright for a non-superuser
    // CREATEROLE owner. Both statements belong in grants.sql, run as
    // adl_migrator. tests/integration/authority-role-grants.test.ts proves the
    // resulting privileges against real PostgreSQL; this is the cheap hermetic
    // guard that the two files do not drift back together.
    const [roles, grants] = await Promise.all([
      readFile("src/server/migrations/roles.sql", "utf8"),
      readFile("src/server/migrations/grants.sql", "utf8"),
    ]);
    expect(roles).not.toMatch(/^\s*grant select/mu);
    expect(roles).not.toMatch(/^\s*alter default privileges/mu);
    expect(grants).toMatch(
      /alter default privileges in schema public\s+grant select, insert, update, delete on tables to adl_authority;/u,
    );
    expect(grants).toContain(
      "grant select, insert, update, delete on all tables in schema public to adl_authority;",
    );
  });
});
