import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project-v2.js";
import {
  AdljParseError,
  compileAdlj,
  adljSourceToPartialApplicationModel,
} from "../src/compiler/compile-adlj.js";
import { printPartialApplicationModelAsAdl } from "../src/compiler/print-adl.js";
import { MODEL_VALIDATION_CODES } from "../src/compiler/validate-model.js";
import { parseExpressionSource } from "../src/parser/parser.js";
import type { AdljSourceDocument } from "../src/model/adlj-source.js";

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

function readReference(name: string): string {
  return readFileSync(new URL(`../src/reference/${name}`, import.meta.url), "utf8");
}

describe("parseExpressionSource", () => {
  it("parses a simple infix expression", () => {
    expect(parseExpressionSource("EndDate >= StartDate")).toMatchObject({
      kind: "binary",
      operator: ">=",
    });
  });

  it("fails on trailing content after a complete expression", () => {
    expect(() => parseExpressionSource("EndDate >= StartDate extra")).toThrowError();
  });
});

describe("compileAdlj", () => {
  it("produces a ResolvedApplicationModel deep-equal to compileAdl's result on the equivalent .adl source", () => {
    const adlResult = compileAdl(readExample("task-tracker.adl"));
    expect(adlResult.diagnostics).toEqual([]);

    const adljResult = compileAdlj(readExample("task-tracker.adlj"));
    expect(adljResult.diagnostics).toEqual([]);

    expect(adljResult.model).toEqual(adlResult.model);
  });

  it("refuses source that is not valid JSON", () => {
    expect(() => compileAdlj("{ not json")).toThrowError(AdljParseError);
    try {
      compileAdlj("{ not json");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdljParseError);
      expect((error as AdljParseError).diagnostic).toMatchObject({
        severity: "error",
        code: MODEL_VALIDATION_CODES.ADLJ_JSON_INVALID,
      });
    }
  });

  it("refuses a document that does not match the generated schema, naming the violating path", () => {
    const invalid = JSON.stringify({ app: { name: "Bad" }, objects: [{ notAField: true }] });

    try {
      compileAdlj(invalid);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdljParseError);
      const diagnostic = (error as AdljParseError).diagnostic;
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.code).toBe(MODEL_VALIDATION_CODES.ADLJ_SCHEMA_INVALID);
      expect(diagnostic.path).toBeDefined();
    }
  });

  it("compiles and round-trips the opt-in mode for generated navigation", () => {
    const source = JSON.stringify({
      app: { name: "GeneratedNavigation", startView: "ItemList" },
      shell: { nav: { mode: "includeUnlistedViews" } },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "ItemList", kind: "list", fields: ["Name"] }],
        },
      ],
    });

    const compiled = compileAdlj(source);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.model.shell.nav).toMatchObject({
      mode: "includeUnlistedViews",
      items: [expect.objectContaining({ view: "ItemList" })],
    });

    const printed = printPartialApplicationModelAsAdl(compiled.partialModel);
    expect(printed).toContain("NAV_MODE INCLUDE_UNLISTED_VIEWS");
    expect(compileAdl(printed).model.shell.nav).toEqual(compiled.model.shell.nav);
  });

  it("rejects an unknown .adlj shell navigation mode", () => {
    const source = JSON.stringify({
      app: { name: "BadNavigation" },
      shell: { nav: { mode: "everythingImplicit" } },
      objects: [{ name: "Item" }],
    });

    expect(() => compileAdlj(source)).toThrowError(AdljParseError);
  });

  it("fails loudly when an expression-bearing field has trailing garbage", () => {
    const document: AdljSourceDocument = {
      app: { name: "TrailingGarbage" },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Value", type: "number", required: true }],
          validations: [{ name: "positive", expression: "Value > 0 extra" }],
        },
      ],
    };

    expect(() => adljSourceToPartialApplicationModel(document)).toThrowError();
  });

  it("compiles an AUTO_ID field with no DEFAULT cleanly through both .adl and .adlj (Phase 74)", () => {
    // Phase 72 refused this shape (ADL_AUTO_ID_NO_DEFAULT) because nothing
    // minted a runtime value from AUTO_ID yet. Phase 74 built that minting
    // (ObjectStore.planCreateForTransaction) and removed the refusal, so both
    // front ends must now resolve this to the identical, diagnostic-free model.
    // See tests/runtime.test.ts's "AUTO_ID minting" suite for proof the field
    // actually mints a value at runtime.
    const document: AdljSourceDocument = {
      app: { name: "AutoIdNoDefault" },
      // Declared explicitly (both empty) so this matches what .adl always
      // resolves for an undeclared contexts/readModels — see
      // learnings/implementation/adlj-json-authoring-surface.md for why a
      // JSON front-end does not infer these defaults for free.
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Item",
          fields: [{ name: "Code", type: "text", required: true, autoId: {} }],
        },
      ],
    };

    const adljResult = compileAdlj(JSON.stringify(document));
    expect(adljResult.diagnostics).toEqual([]);

    // The same shape, hand-ported to .adl text, must resolve identically —
    // proving both front-ends reach validateApplicationModel unchanged.
    const adlResult = compileAdl(`APP AutoIdNoDefault
END.APP

OBJECT Item
  FIELD Code TEXT REQUIRED AUTO_ID
END.OBJECT
`);
    expect(adlResult.diagnostics).toEqual([]);
    expect(adljResult.model).toEqual(adlResult.model);
  });
});

describe('comment threading: AdljSourceDocument "comment" -> PartialApplicationModel comment', () => {
  it('reads the JSON "comment" key into the same field .adl text populates, and the printer emits it as a # line', () => {
    const document: AdljSourceDocument = {
      app: { name: "AdljComment", comment: "Why this app exists" },
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Widget",
          comment: "Why this object exists",
          fields: [
            {
              name: "Name",
              type: "text",
              required: true,
              comment: "Why this field is required",
            },
          ],
        },
      ],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);
    expect(partialModel.app.comment).toBe("Why this app exists");
    expect(partialModel.objects[0]?.comment).toBe("Why this object exists");
    expect(partialModel.objects[0]?.fields?.[0]?.comment).toBe("Why this field is required");

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).toContain("# Why this app exists\nAPP");
    expect(printed).toContain("# Why this object exists\nOBJECT Widget");
    expect(printed).toContain("  # Why this field is required\n  FIELD Name");

    // And the printed text reparses through .adl's own front end carrying
    // the identical comment, proving the two front ends agree on the shape.
    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.partialModel.app.comment).toBe("Why this app exists");
    expect(reparsed.partialModel.objects[0]?.comment).toBe("Why this object exists");
    expect(reparsed.partialModel.objects[0]?.fields?.[0]?.comment).toBe(
      "Why this field is required",
    );
  });

  it("prints a multi-line comment field as one # line per \\n-separated line", () => {
    const document: AdljSourceDocument = {
      app: { name: "MultiLineComment" },
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Widget",
          comment: "First line\nSecond line",
          fields: [{ name: "Name", type: "text", required: true }],
        },
      ],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).toContain("# First line\n# Second line\nOBJECT Widget");
  });

  it("omits the comment entirely (no printed # line, no field) when the .adlj document declares none", () => {
    const document: AdljSourceDocument = {
      app: { name: "NoComment" },
      contexts: [],
      readModels: [],
      objects: [{ name: "Widget", fields: [{ name: "Name", type: "text", required: true }] }],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);
    expect(partialModel.app.comment).toBeUndefined();
    expect(partialModel.objects[0]?.comment).toBeUndefined();

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).not.toContain("#");
  });
});

describe("printPartialApplicationModelAsAdl", () => {
  // A permanent CI drift check (Phase 78): for every fixture below, printing
  // the compiled `partialModel` back to `.adl` text and reparsing it must
  // resolve to a model deep-equal to the original. If a future change to a
  // fixture's source, the printer, or the resolver introduces a divergence the
  // printer cannot round-trip, one of these tests catches it.
  //
  // Phase 98 deleted Giggle Band's `.adl` snapshot, which used to supply the
  // rich half of this proof. The replacement subjects are real `.adlj` sources
  // and the `examples/` corpus, so nothing here depends on hand-authored `.adl`
  // text: `.adl` is the printed view of `.adlj`, and this describes what that
  // view can and cannot say. Coverage after the replacement is stated in
  // `docs/phases/phase-98-delete-kept-adl-snapshot.md`; the constructs no
  // fixture reaches any more (`STATUS_MAP`, `ICON_MAP`, presentation
  // `TOGGLE`, `UNION`, a qualified `READ_MODEL SOURCE JOIN`, `ATTACHMENT`)
  // are named there rather than quietly dropped.
  it("round-trips the task-tracker fixture: print, reparse, resolve to the identical model", () => {
    const original = compileAdl(readExample("task-tracker.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the Jointly Care reference app: compile its real `.adlj` source, print, reparse", () => {
    // Jointly Care is the richest application source the printer can render at
    // all: three `CONTEXT` declarations and three `CONTEXT_GRANT`s, twenty
    // read models, a global `SHELL` with both a top bar and a nav drawer,
    // calendars, legends, composed sections, commands, thirty-two policies,
    // computed fields and four `MIGRATION` hops. Giggle Band cannot stand in
    // for it: `print-adl.ts` refuses that source outright, because it declares
    // three constructs with no ADL text syntax at all (a calendar
    // `conflictOverlay`, and a child collection's `projectedFields` and
    // `summary`) — see the last test in this block.
    const original = compileAdlProjectV2({
      manifestSource: readReference("jointly-care/app.yaml"),
      sources: {
        "domain.adlj": readReference("jointly-care/domain.adlj"),
        "ui.adlj": readReference("jointly-care/ui.adlj"),
      },
    });
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the purchase-order example: edit surfaces, pickers, child collections, lifecycle", () => {
    // What Jointly Care does not exercise: `LIFECYCLE` with terminal states,
    // `EDIT_SECTION`s, an `ORDERED` child collection, both relationship-picker
    // modes, and a policy rule carrying `FIELDS` alongside `ROLE` and `STATE`
    // — the combination that exposed the missing `FIELDS` stop word in
    // `src/parser/grammar/policy.ts` (Phase 98).
    const original = compileAdl(readExample("purchase-order.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("prints MIGRATION blocks, including a hop that reshapes no record", () => {
    // `MIGRATION` had text grammar from the start and was never printed, so
    // every hop vanished from the printed `.adl` — silently, unlike the
    // constructs the printer refuses by name. Neither round-trip fixture that
    // existed before Phase 98 declared a migration, so nothing caught it until
    // Jointly Care's four hops came back as `migrations: []`.
    const original = compileAdlj(
      JSON.stringify({
        app: { name: "MigrationPrinting", startView: "WidgetList" },
        modelVersion: "1.2.0",
        contexts: [],
        readModels: [],
        objects: [
          {
            name: "Widget",
            schemaVersion: 2,
            businessKey: "Code",
            displayField: "Label",
            fields: [
              { name: "Code", type: "text", required: true },
              { name: "Label", type: "text", required: true },
              { name: "PayoutCents", type: "number" },
            ],
            views: [{ name: "WidgetList", kind: "list", fields: ["Code", "Label"] }],
          },
        ],
        migrations: [
          // A version bump whose records need no reshaping is legal and
          // meaningful, and prints as an empty MIGRATION/END.MIGRATION pair.
          { from: "1.0.0", to: "1.1.0" },
          {
            from: "1.1.0",
            to: "1.2.0",
            objects: [
              {
                object: "Widget",
                schemaVersion: 2,
                steps: [
                  { kind: "renameField", from: "Name", to: "Label" },
                  { kind: "addField", field: "PayoutCents", defaultValue: 0 },
                  { kind: "dropField", field: "LegacyNote" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    expect(printed).toContain(
      [
        "MIGRATION FROM '1.0.0' TO '1.1.0'",
        "END.MIGRATION",
        "",
        "MIGRATION FROM '1.1.0' TO '1.2.0'",
        "  OBJECT Widget",
        "    SCHEMA_VERSION 2",
        "    RENAME FIELD Name TO Label",
        "    ADD FIELD PayoutCents DEFAULT(0)",
        "    DROP FIELD LegacyNote",
        "  END.OBJECT",
        "END.MIGRATION",
      ].join("\n"),
    );

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("refuses, by name, a source using a construct with no ADL text syntax", () => {
    // The printer's contract: a construct it cannot render throws a clear,
    // named error rather than silently dropping declared content. Giggle Band's
    // real source is the standing proof — and the reason `.adl` text cannot be
    // a complete view of `.adlj` today (`docs/spec/adlj.md`).
    const real = compileAdlProjectV2({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adlj": readReference("giggle-band/domain.adlj"),
        "ui.adlj": readReference("giggle-band/ui.adlj"),
      },
    });
    expect(real.diagnostics).toEqual([]);

    expect(() => printPartialApplicationModelAsAdl(real.partialModel)).toThrow(/conflictOverlay/);
  });
});
