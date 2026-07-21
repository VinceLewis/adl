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
});
