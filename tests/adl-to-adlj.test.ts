import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlj } from "../src/compiler/compile-adlj.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project-v2.js";
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

  it("carries Giggle Band all the way round: .adlj -> print -> import -> .adlj -> identical model", () => {
    // The importer shares `PartialApplicationModel` with the printer and passes
    // most structures through untouched, so a construct the printer newly
    // learned to emit reaches the importer with no code of its own. That is
    // the cheap case to get wrong silently, and Giggle Band is the only source
    // exercising `conflictOverlay`, `projectedFields` and `summary` at all —
    // so the full circle is what proves the importer carries them. Phase 100.
    const original = compileAdlProjectV2({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adlj": readReference("giggle-band/domain.adlj"),
        "ui.adlj": readReference("giggle-band/ui.adlj"),
      },
    });
    expect(original.diagnostics).toEqual([]);

    const imported = importAdlAsAdlj(printPartialApplicationModelAsAdl(original.partialModel));
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).toBeDefined();

    const recompiled = compileAdlj(JSON.stringify(imported.document));
    expect(recompiled.diagnostics).toEqual([]);
    expect(recompiled.model).toEqual(original.model);
  });

  it("carries a MATRIX all the way round: .adlj -> print -> import -> .adlj -> identical model", () => {
    // Same argument as the Giggle Band circle above, for Phase 104's addition:
    // `adl-to-adlj.ts` destructures a section into `{ controls, lists,
    // calendars, ...rest }`, so `matrices` reaches the importer through `rest`
    // with no code of its own — which is precisely the case that breaks
    // silently if the shape ever stops passing through untouched. Neither
    // reference app declares a matrix, so this fixture is the only thing that
    // would notice.
    const corpus = JSON.parse(
      readFileSync(
        new URL("../conformance/presentation/status-matrix-calendar.json", import.meta.url),
        "utf8",
      ),
    ) as { models: Record<string, Record<string, unknown>> };
    const original = compileAdlj(
      JSON.stringify({ contexts: [], readModels: [], ...corpus.models.resourceMatrix }),
    );
    expect(original.diagnostics).toEqual([]);

    const imported = importAdlAsAdlj(printPartialApplicationModelAsAdl(original.partialModel));
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).toBeDefined();

    // The importer must carry the matrices, not merely produce a document that
    // happens to resolve: an importer that dropped them would leave a document
    // whose sections have no `matrices` key at all, and the resolved-model
    // comparison below would then be comparing two matrix-less models.
    const section = (
      imported.document as unknown as {
        objects: {
          views?: { presentation?: { sections?: { matrices?: unknown[] }[] } }[];
        }[];
      }
    ).objects[0]?.views?.[0]?.presentation?.sections?.[0];
    expect(section?.matrices).toHaveLength(1);

    const recompiled = compileAdlj(JSON.stringify(imported.document));
    expect(recompiled.diagnostics).toEqual([]);
    expect(recompiled.model).toEqual(original.model);
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
  // Jointly Care's `domain.adlj`/`ui.adlj` are themselves the real,
  // comment-carrying compiled source now (see `app.yaml`'s `sources:` and
  // `learnings/implementation/adlj-json-authoring-surface.md`) -- there is
  // no separate `.adl` text fixture to round-trip through `importAdlAsAdlj`
  // any more, so this proves comment preservation directly against the
  // real compiled `.adlj` pair via `compileAdlProjectV2`, the same compiler
  // `jointly-app.ts` uses.
  it("preserves every real leading comment in Jointly Care's domain.adlj + ui.adlj", () => {
    const original = compileAdlProjectV2({
      manifestSource: readReference("jointly-care/app.yaml"),
      sources: {
        "domain.adlj": readReference("jointly-care/domain.adlj"),
        "ui.adlj": readReference("jointly-care/ui.adlj"),
      },
    });
    expect(original.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const originalComments = collectComments(original.partialModel);
    // Sanity: this must be a real, non-vacuous proof against real content.
    expect(originalComments.length).toBeGreaterThanOrEqual(14);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
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

  // Giggle Band's `domain.adlj`/`ui.adlj` are themselves the real,
  // comment-carrying compiled source now too (see `app.yaml`'s `sources:`
  // and `learnings/implementation/adlj-json-authoring-surface.md`), so this
  // proves comment preservation directly against the real compiled `.adlj`
  // pair via `compileAdlProjectV2`, mirroring the Jointly Care case above.
  // The `domain.adl`/`ui.adl` text these `.adlj` files were converted from
  // (`importAdlAsAdlj`, proven once at conversion time) was deleted in
  // Phase 98: it had frozen at model version 1.0.0 while the application
  // reached 1.9.0, and `.adl` text is the printed view of `.adlj`, not a
  // second source anyone maintains.
  it("preserves every real leading comment in Giggle Band's domain.adlj + ui.adlj", () => {
    // Giggle Band exercises comment shapes Jointly Care does not: a SECTION
    // comment (`DuplicateGig`), a row ACTION comment (`duplicateGig`), a
    // PICKER comment (`SongPicker`), and READ_MODEL/FIELD comments on
    // `SentBandInvitations`/`MyAvailabilityWithGigs`. It also exercises a
    // second construct that used to be unprintable beyond `conflictOverlay`:
    // `SetListForm`'s `Songs` child collection declares
    // `projectedFields`/`summary` (Phase 87). Both gained text syntax in
    // Phase 100, so this now prints the real model rather than a stripped
    // clone of it.
    const original = compileAdlProjectV2({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adlj": readReference("giggle-band/domain.adlj"),
        "ui.adlj": readReference("giggle-band/ui.adlj"),
      },
    });
    expect(original.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const originalComments = collectComments(original.partialModel);
    // Sanity: this must be a real, non-vacuous proof against real content.
    expect(originalComments.length).toBeGreaterThanOrEqual(10);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
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
});
