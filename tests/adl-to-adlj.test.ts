import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlj } from "../src/compiler/compile-adlj.js";
import { printPartialApplicationModelAsAdl } from "../src/compiler/print-adl.js";
import {
  importAdlAsAdlj,
  partialApplicationModelToAdljSource,
} from "../src/compiler/adl-to-adlj.js";
import type { PartialApplicationModel } from "../src/model/resolved-model.js";

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

function readReference(name: string): string {
  return readFileSync(new URL(`../src/reference/${name}`, import.meta.url), "utf8");
}

/**
 * Recursively collects every `comment` field value in a `PartialApplicationModel`
 * (or any nested part of one), in a stable traversal order determined by
 * object key order and array order. Two models built from the identical
 * source content produce the identical list here even when other formatting
 * differs, which is what makes this a precise "did the actual rationale text
 * survive, unmangled" check rather than a full-text diff that would also
 * fail on harmless printer reformatting.
 */
function collectComments(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectComments(item, seen));
  }
  const found: string[] = [];
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === "comment" && typeof val === "string") {
      found.push(val);
    } else {
      found.push(...collectComments(val, seen));
    }
  }
  return found;
}

/**
 * `collectComments`, order-independent. Each conversion stage in the
 * `.adl -> .adlj -> .adl` pipeline rebuilds every object via a
 * destructure-then-spread pattern (see
 * `learnings/implementation/adlj-json-authoring-surface.md`), and each of
 * those patterns places the fields it does not itself transform (`comment`
 * among them) back in a slightly different relative key order — harmless
 * reordering, not content loss. Sorting before comparing checks the actual
 * thing this test cares about (did the set of comment strings survive,
 * unmangled) without being fooled by that reordering, and without being
 * fooled by real loss either: two different real comments in this corpus
 * are never byte-identical, so a sorted comparison cannot hide a dropped or
 * corrupted one behind a coincidental duplicate.
 */
function sortedComments(value: unknown): string[] {
  return collectComments(value).slice().sort();
}

describe("partialApplicationModelToAdljSource", () => {
  it("converts a hand-built PartialApplicationModel's computed field, object validation, and policy condition to infix strings", () => {
    const model: PartialApplicationModel = {
      app: { name: "Widgets" },
      objects: [
        {
          name: "Widget",
          fields: [{ name: "Count", type: "number", required: true }],
          computedFields: [
            {
              name: "IsPlentiful",
              type: "boolean",
              expression: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 10 },
              },
            },
          ],
          validations: [
            {
              name: "countNonNegative",
              expression: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 0 },
              },
              message: "Count must not be negative.",
            },
          ],
        },
      ],
      policies: [
        {
          name: "WidgetPolicy",
          object: "Widget",
          rules: [
            {
              name: "allowReadPlentiful",
              effect: "allow",
              principal: { match: "everyone" },
              action: "read",
              condition: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 10 },
              },
            },
          ],
        },
      ],
    };

    const document = partialApplicationModelToAdljSource(model);

    expect(document.objects[0]?.computedFields?.[0]).toEqual({
      name: "IsPlentiful",
      type: "boolean",
      expression: "Count >= 10",
    });
    expect(document.objects[0]?.validations?.[0]).toEqual({
      name: "countNonNegative",
      expression: "Count >= 0",
      message: "Count must not be negative.",
    });
    expect(document.policies?.[0]?.rules?.[0]?.condition).toBe("Count >= 10");
  });
});

describe("importAdlAsAdlj", () => {
  it("compiles clean .adl source and converts it to an AdljSourceDocument", () => {
    const result = importAdlAsAdlj(readExample("task-tracker.adl"));

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.document).toBeDefined();
    expect(result.document?.app.name).toBe("TaskTracker");
  });

  it("returns diagnostics without a document when .adl source has errors", () => {
    const result = importAdlAsAdlj(`APP Broken
END.APP

OBJECT Thing
  VALIDATE bad NotAField > 0
END.OBJECT
`);

    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(result.document).toBeUndefined();
  });

  it("round-trips task-tracker.adl through .adlj to an identical resolved model", () => {
    const adlResult = compileAdl(readExample("task-tracker.adl"));
    expect(adlResult.diagnostics).toEqual([]);

    const imported = importAdlAsAdlj(readExample("task-tracker.adl"));
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).toBeDefined();

    const adljResult = compileAdlj(JSON.stringify(imported.document));
    expect(adljResult.diagnostics).toEqual([]);

    expect(adljResult.model).toEqual(adlResult.model);
  });
});

describe("comment preservation through the full .adl -> .adlj -> .adl round trip", () => {
  // Both fixtures are read-only real reference content (Jointly Care's
  // `.adl` files are the kept, unwired, heavily-commented reference source;
  // Giggle Band's `.adl` files are still its real compiled source) — neither
  // is modified or reconverted here. `.adl` text with no `APP` block (every
  // `ui.adl`) cannot be parsed alone (`parseAdl` requires `APP` first), so
  // each pair is concatenated the same way `compileAdlProject` concatenates
  // manifest sources before parsing.
  it("preserves every real leading comment for Jointly Care's domain.adl + ui.adl", () => {
    const combined = [
      readReference("jointly-care/domain.adl"),
      readReference("jointly-care/ui.adl"),
    ].join("\n\n");

    const original = compileAdl(combined);
    expect(original.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const originalComments = collectComments(original.partialModel);
    // Sanity: this must be a real, non-vacuous proof against real content.
    expect(originalComments.length).toBeGreaterThanOrEqual(14);

    const imported = importAdlAsAdlj(combined);
    expect(imported.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(imported.document).toBeDefined();

    const adljResult = compileAdlj(JSON.stringify(imported.document));
    expect(adljResult.diagnostics).toEqual([]);
    expect(adljResult.model).toEqual(original.model);
    expect(sortedComments(adljResult.partialModel)).toEqual(sortedComments(original.partialModel));

    const printed = printPartialApplicationModelAsAdl(adljResult.partialModel);
    for (const comment of originalComments) {
      for (const line of comment.split("\n")) {
        expect(printed).toContain(line.length === 0 ? "#" : `# ${line}`);
      }
    }

    // The printed .adl view itself reparses carrying the identical comments —
    // not just a structurally-equal model, the actual rationale text again.
    const reprinted = compileAdl(printed);
    expect(reprinted.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(sortedComments(reprinted.partialModel)).toEqual(sortedComments(original.partialModel));
  });

  it("preserves every real leading comment for Giggle Band's domain.adl + ui.adl", () => {
    // Giggle Band exercises comment shapes Jointly Care does not: a SECTION
    // comment (`DuplicateGig`), a row ACTION comment (`duplicateGig`), a
    // PICKER comment (`SongPicker`), and READ_MODEL/FIELD comments on
    // `SentBandInvitations`/`MyAvailabilityWithGigs`.
    const combined = [
      readReference("giggle-band/domain.adl"),
      readReference("giggle-band/ui.adl"),
    ].join("\n\n");

    const original = compileAdl(combined);
    expect(original.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const originalComments = collectComments(original.partialModel);
    expect(originalComments.length).toBeGreaterThanOrEqual(10);

    const imported = importAdlAsAdlj(combined);
    expect(imported.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(imported.document).toBeDefined();

    const adljResult = compileAdlj(JSON.stringify(imported.document));
    expect(adljResult.diagnostics).toEqual([]);
    expect(adljResult.model).toEqual(original.model);
    expect(sortedComments(adljResult.partialModel)).toEqual(sortedComments(original.partialModel));

    const printed = printPartialApplicationModelAsAdl(adljResult.partialModel);
    for (const comment of originalComments) {
      for (const line of comment.split("\n")) {
        expect(printed).toContain(line.length === 0 ? "#" : `# ${line}`);
      }
    }

    const reprinted = compileAdl(printed);
    expect(reprinted.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(sortedComments(reprinted.partialModel)).toEqual(sortedComments(original.partialModel));
  });
});
