import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
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

  it("fires the same model-validation diagnostic .adl reports for an AUTO_ID field with no DEFAULT", () => {
    const document: AdljSourceDocument = {
      app: { name: "AutoIdNoDefault" },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Code", type: "text", required: true, autoId: {} }],
        },
      ],
    };

    const { diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: MODEL_VALIDATION_CODES.AUTO_ID_NO_DEFAULT }),
      ]),
    );

    // The same shape, hand-ported to .adl text, must fire the identical code —
    // proving both front-ends reach validateApplicationModel unchanged.
    const adlDiagnostics = compileAdl(`APP AutoIdNoDefault
END.APP

OBJECT Item
  FIELD Code TEXT REQUIRED AUTO_ID
END.OBJECT
`).diagnostics;
    expect(adlDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: MODEL_VALIDATION_CODES.AUTO_ID_NO_DEFAULT }),
      ]),
    );
  });
});

describe("printPartialApplicationModelAsAdl", () => {
  it("round-trips the task-tracker fixture: print, reparse, resolve to the identical model", () => {
    const original = compileAdl(readExample("task-tracker.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });
});
