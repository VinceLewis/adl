import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError, lexAdl, parseAdl } from "../src/index.js";

describe("ADL parser", () => {
  it("parses the representative User example into an AST", () => {
    const ast = parseAdl(readExample("user.adl"));
    const user = ast.objects.find((object) => object.name === "User");

    expect(ast.app).toMatchObject({
      name: "UserDirectory",
      theme: "DirectoryTheme",
      startView: "UserList",
    });
    expect(ast.roles.map((role) => role.name)).toEqual(["Admin", "Viewer"]);
    expect(ast.themes[0]).toMatchObject({
      name: "DirectoryTheme",
      base: "CorporateLight",
    });
    expect(user?.fields.map((field) => field.name)).toEqual([
      "Name",
      "Email",
      "Phone",
      "Active",
      "Status",
    ]);
    expect(user?.fields.find((field) => field.name === "Name")?.validators).toEqual([
      expect.objectContaining({ validatorKind: "maxLength", value: 100 }),
    ]);
    expect(user?.fields.find((field) => field.name === "Email")?.validators).toEqual([
      expect.objectContaining({ validatorKind: "email" }),
    ]);
    expect(user?.lifecycle?.actions[0]).toMatchObject({
      name: "activate",
      from: ["Draft"],
      to: "Active",
      allowRules: [expect.objectContaining({ roles: ["Admin"] })],
    });
  });

  it("tracks useful token locations from the lexer", () => {
    const tokens = lexAdl("APP Demo\n  START_VIEW UserList\nEND.APP\n");
    const startView = tokens.find((token) => token.lexeme === "START_VIEW");

    expect(startView?.range.start).toMatchObject({ line: 2, column: 3 });
  });

  it("parses field predicate validators and policy WHEN expressions", () => {
    const ast = parseAdl(`APP Expressions
END.APP

ROLE Requester

OBJECT PurchaseOrder
  FIELD Owner TEXT
  FIELD Value NUMBER VALIDATE Value > 0 MESSAGE 'Positive only.'
END.OBJECT

POLICY PurchaseOrderPolicy ON PurchaseOrder
  ALLOW CREATE ROLE Requester WHEN Owner == runtime.userId AND Value > 10000
END.POLICY
`);

    const purchaseOrder = ast.objects.find((object) => object.name === "PurchaseOrder");
    expect(
      purchaseOrder?.fields.find((field) => field.name === "Value")?.validators[0],
    ).toMatchObject({
      validatorKind: "predicate",
      message: "Positive only.",
      expression: {
        kind: "binary",
        operator: ">",
      },
    });
    expect(ast.policies[0]?.rules[0]?.condition).toMatchObject({
      kind: "binary",
      operator: "and",
    });
  });

  it("parses object validations, decision tables, lifecycle guards, and commands", () => {
    const ast = parseAdl(`APP Phase21
END.APP

OBJECT PurchaseOrder
  FIELD Owner TEXT REQUIRED
  FIELD Value NUMBER REQUIRED
  FIELD Status TEXT DEFAULT Draft
  FIELD Reviewed BOOLEAN DEFAULT FALSE
  VALIDATE ApprovalCommentRequired WHEN Value <= 10000 OR Reviewed == TRUE MESSAGE 'Review required.'

  LIFECYCLE PurchaseOrderLifecycle FIELD Status INITIAL Draft
    STATE Draft
    STATE Approved
    ACTION approve FROM Draft TO Approved WHEN Reviewed == TRUE MESSAGE 'Review first.'
      ALLOW ROLE Approver
    END.ACTION
  END.LIFECYCLE
END.OBJECT

DECISION_TABLE ApprovalTier ON PurchaseOrder MATCH SINGLE
  INPUT amount = Value
  ROW standard WHEN amount <= 10000 OUTPUT tier 'standard'
  ROW senior WHEN amount > 10000 OUTPUT tier 'senior'
  DEFAULT OUTPUT tier 'unknown'
END.DECISION_TABLE

COMMAND CreatePurchaseOrder LABEL 'Create purchase order'
  INPUT Owner TEXT REQUIRED
  INPUT Value NUMBER REQUIRED
  REQUIRE Value > 0 MESSAGE 'Value must be positive.'
  STEP createOrder CREATE PurchaseOrder AUTHORITY command
    VALUE Owner INPUT Owner
    VALUE Value INPUT Value
    VALUE Status LITERAL Draft
    VALUE Reviewed LITERAL TRUE
  END.STEP
END.COMMAND
`);

    expect(ast.objects[0]?.validations[0]).toMatchObject({
      name: "ApprovalCommentRequired",
      message: "Review required.",
    });
    expect(ast.objects[0]?.lifecycle?.actions[0]?.guards[0]).toMatchObject({
      message: "Review first.",
    });
    expect(ast.decisionTables[0]).toMatchObject({
      name: "ApprovalTier",
      object: "PurchaseOrder",
      match: "single",
    });
    expect(ast.commands[0]).toMatchObject({
      name: "CreatePurchaseOrder",
      preconditions: [expect.objectContaining({ message: "Value must be positive." })],
      steps: [expect.objectContaining({ name: "createOrder", action: "create" })],
    });
  });

  it("reports missing block terminators with a source location", () => {
    expect(() =>
      parseAdl(`APP Broken
END.APP

OBJECT User
  FIELD Name TEXT
`),
    ).toThrow(ParseError);

    try {
      parseAdl(`APP Broken
END.APP

OBJECT User
  FIELD Name TEXT
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic).toMatchObject({
        code: "ADL_PARSE_EXPECTED_TOKEN",
      });
      expect(error.diagnostic.message).toContain("END.OBJECT");
      expect(error.diagnostic.sourceRange.start.line).toBeGreaterThanOrEqual(5);
    }
  });

  it("rejects unsupported procedural keywords", () => {
    expect(() =>
      parseAdl(`APP Bad
END.APP

FETCH FILE(User)
`),
    ).toThrow(ParseError);

    try {
      parseAdl(`APP Bad
END.APP

FETCH FILE(User)
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic).toMatchObject({
        code: "ADL_PARSE_UNSUPPORTED_PROCEDURAL_KEYWORD",
      });
      expect(error.diagnostic.message).toContain("FETCH");
      expect(error.diagnostic.sourceRange.start).toMatchObject({ line: 4, column: 1 });
    }
  });
});

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}
