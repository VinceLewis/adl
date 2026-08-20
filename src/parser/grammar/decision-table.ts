import type { JsonValue } from "../../model/resolved-model.js";
import type {
  DecisionTableDeclarationAst,
  DecisionTableInputDeclarationAst,
  DecisionTableRowDeclarationAst,
} from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { PolicyParser } from "./policy.js";

/**
 * `DECISION_TABLE` declarations, inputs and rows.
 */
export class DecisionTableParser extends PolicyParser {
  protected parseDecisionTable(): DecisionTableDeclarationAst {
    const startToken = this.expectUnderscoreOrDottedWord(
      "top-level DECISION_TABLE block",
      "DECISION_TABLE",
      "DECISION",
      "TABLE",
      "DECISION_TABLE declaration",
    );
    const name = this.consumeName("decision table name");
    this.expectWord("ON", "DECISION_TABLE ON clause");
    const object = this.consumeName("decision table object name");
    let match: "first" | "single" = "first";

    while (!this.isLineEnd()) {
      if (this.matchWord("MATCH")) {
        match = this.parseDecisionTableMatch();
      } else {
        this.failUnexpected("DECISION_TABLE header option MATCH or end of line");
      }
    }
    this.consumeLineEnd("DECISION_TABLE declaration");

    const inputs: DecisionTableInputDeclarationAst[] = [];
    const rows: DecisionTableRowDeclarationAst[] = [];
    let defaultOutputs: Record<string, JsonValue> | undefined;

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.DECISION_TABLE", this.current());
      }

      if (this.checkEnd("DECISION_TABLE")) {
        const end = this.parseEnd("DECISION_TABLE");
        return {
          kind: "DecisionTableDeclaration",
          name,
          object,
          match,
          inputs,
          rows,
          ...(defaultOutputs === undefined ? {} : { defaultOutputs }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("INPUT")) {
        inputs.push(this.parseDecisionTableInput());
      } else if (this.checkWord("ROW")) {
        rows.push(this.parseDecisionTableRow());
      } else if (this.matchWord("DEFAULT")) {
        if (this.matchWord("OUTPUT")) {
          // OUTPUT is optional noise after DEFAULT.
        }
        defaultOutputs = this.consumeOutputMapUntilLine("decision table default output");
        this.consumeLineEnd("DECISION_TABLE DEFAULT directive");
      } else {
        this.failUnexpected("DECISION_TABLE directive INPUT, ROW, DEFAULT, or END.DECISION_TABLE");
      }
    }
  }

  private parseDecisionTableMatch(): "first" | "single" {
    const raw = normaliseKeyword(this.consumeName("decision table match policy"));
    if (raw === "first" || raw === "firstmatch") {
      return "first";
    }
    if (raw === "single" || raw === "singlematch") {
      return "single";
    }
    this.failExpected("decision table match policy FIRST or SINGLE", this.previous());
  }

  private parseDecisionTableInput(): DecisionTableInputDeclarationAst {
    const startToken = this.expectWord("INPUT", "DECISION_TABLE INPUT directive");
    const name = this.consumeName("decision table input name");
    const binderToken = this.current();
    if (this.matchSymbol("=")) {
      // Canonical form.
    } else if (this.matchWord("FROM")) {
      this.recordDeprecatedSpelling("DECISION_TABLE INPUT binder", "FROM", "=", binderToken);
    }
    const expression = this.parseExpressionUntil(new Set());
    this.consumeLineEnd("DECISION_TABLE INPUT directive");
    return {
      kind: "DecisionTableInputDeclaration",
      name,
      expression,
      range: this.rangeFrom(startToken),
    };
  }

  private parseDecisionTableRow(): DecisionTableRowDeclarationAst {
    const startToken = this.expectWord("ROW", "DECISION_TABLE ROW directive");
    const name = this.consumeName("decision table row name");
    // Required, not optional (Phase 72): a bare condition immediately after
    // the row name read worse than costing one word to require permanently.
    // Every real DECISION_TABLE ROW already writes WHEN, so this breaks no
    // existing content.
    this.expectWord("WHEN", "DECISION_TABLE ROW WHEN clause");
    const condition = this.parseExpressionUntil(new Set(["OUTPUT"]));
    this.expectWord("OUTPUT", "DECISION_TABLE ROW OUTPUT clause");
    const outputs = this.consumeOutputMapUntilLine("decision table row output");
    this.consumeLineEnd("DECISION_TABLE ROW directive");
    return {
      kind: "DecisionTableRowDeclaration",
      name,
      condition,
      outputs,
      range: this.rangeFrom(startToken),
    };
  }
}
