import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MODEL_VALIDATION_CODES,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { PartialApplicationModel, PartialModelMigrationModel } from "../src/index.js";

/**
 * Phase 70 regression.
 *
 * Three composite-key builders separate their two parts with `\0` precisely
 * because neither part can itself contain a NUL: `validateModelMigrations`
 * (model version pairs), the authority-bootstrap sort key in
 * `src/conformance/runner.ts` (object + record id), and `SuppliedRecordIds` in
 * `src/runtime/command-service.ts` (object + record id). Two more template
 * literals of the same shape were found alongside them, in
 * `src/runtime/startup-compatibility.ts`.
 *
 * Phase 58 already introduced this defect once, by accident, in
 * `src/server/sync-client.ts`: a `` `${object}\0${id}` `` key where the
 * separator landed as a literal 0x00 byte instead of the two-character escape
 * `\0`. Phase 69's reconnaissance re-discovered the same defect, independently
 * reintroduced, in three more files — a raw NUL byte physically in the source
 * makes many `grep`/`ripgrep`/`ugrep` implementations treat the file as binary
 * and silently return nothing for any search that touches the affected line,
 * which is exactly what let it go unnoticed. Phase 70 replaced all five raw
 * bytes with the `\0` escape, which produces the identical runtime string.
 *
 * This file pins two things so the defect cannot return unnoticed a third
 * time: that none of the five files carry a raw NUL byte again, and that the
 * validator's own composite key still behaves the way the NUL separator is
 * meant to guarantee — two boundary-ambiguous inputs never collide.
 */

const FILES_WITH_NUL_SEPARATED_COMPOSITE_KEYS = [
  "src/compiler/validate-model.ts",
  "src/conformance/runner.ts",
  "src/runtime/command-service.ts",
  "src/runtime/startup-compatibility.ts",
  "tests/authority-retention-configuration.test.ts",
];

describe("composite-key NUL separator source encoding", () => {
  it.each(FILES_WITH_NUL_SEPARATED_COMPOSITE_KEYS)(
    "%s carries the \\0 escape, never a raw NUL byte",
    (relativePath) => {
      const bytes = readFileSync(new URL(`../${relativePath}`, import.meta.url));

      expect(bytes.includes(0)).toBe(false);
    },
  );

  it("validateModelMigrations does not collide two migrations whose from/to only match once joined without a separator", () => {
    // Without a separator (or with an ambiguous one), from: "A", to: "BC" and
    // from: "AB", to: "C" would both concatenate to "ABC" and be reported as
    // the same migration declared twice. Neither a version string nor an
    // object name can contain a NUL, so joining with `\0` is unambiguous and
    // both migrations below are distinct, valid declarations.
    const migrations: PartialModelMigrationModel[] = [
      { from: "A", to: "BC" },
      { from: "AB", to: "C" },
    ];

    const diagnostics = validateApplicationModel(resolveApplicationModel(minimalModel(migrations)));

    expect(
      diagnostics.filter((d) => d.code === MODEL_VALIDATION_CODES.MIGRATION_DUPLICATE),
    ).toEqual([]);
  });

  it("validateModelMigrations still reports a genuine duplicate from/to pair", () => {
    const migrations: PartialModelMigrationModel[] = [
      { from: "1.0.0", to: "1.1.0" },
      { from: "1.0.0", to: "1.1.0" },
    ];

    const diagnostics = validateApplicationModel(resolveApplicationModel(minimalModel(migrations)));

    expect(
      diagnostics.filter((d) => d.code === MODEL_VALIDATION_CODES.MIGRATION_DUPLICATE),
    ).toHaveLength(1);
  });
});

function minimalModel(migrations: PartialModelMigrationModel[]): PartialApplicationModel {
  return {
    modelVersion: "1.1.0",
    app: { name: "GigBook" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Gig",
        businessKey: "Title",
        displayField: "Title",
        fields: [{ name: "Title", type: "text", required: true }],
      },
    ],
    policies: [
      {
        name: "GigPolicy",
        object: "Gig",
        rules: [
          {
            name: "allowAdminGigOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
    migrations,
  };
}
