import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlProject } from "../src/compiler/compile-adl-project.js";
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
  // A permanent CI drift check (Phase 78): for both fixtures below, printing
  // the compiled `partialModel` back to `.adl` text and reparsing it must
  // resolve to a model deep-equal to the original. If a future change to
  // either fixture's source, the printer, or the resolver introduces a
  // divergence the printer cannot round-trip, one of these two tests catches
  // it — task-tracker for the plain declarative skeleton, Giggle Band for
  // composed presentation and edit surfaces, the richest real content in
  // this repository for both.
  it("round-trips the task-tracker fixture: print, reparse, resolve to the identical model", () => {
    const original = compileAdl(readExample("task-tracker.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the Giggle Band reference app: print, reparse, resolve to the identical model", () => {
    // Giggle Band is the richest real presentation/edit-surface content in
    // this repository — composed dashboards, icon/status maps, legends,
    // toggles, row-scoped actions, calendars, CRUD edit sections, child
    // collections, both relationship-picker modes, a global SHELL, `UNION`
    // read models, a qualified `READ_MODEL SOURCE JOIN`, a policy `FIELDS`
    // clause naming a field that collides with a principal-selector keyword
    // (`Role`), and list-typed command inputs with structured item fields.
    // This is the actual proof the printer's construct coverage is real,
    // not just what a hand-built small fixture happens to exercise.
    const original = compileAdlProject({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adl": readReference("giggle-band/domain.adl"),
        "ui.adl": readReference("giggle-band/ui.adl"),
      },
    });
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });
});
