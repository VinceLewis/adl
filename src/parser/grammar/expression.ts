import type { ExpressionRuntimeProperty, ResolvedExpression } from "../../model/resolved-model.js";
import { normaliseKeyword } from "./text.js";
import { ClauseParser } from "./clauses.js";

/**
 * The infix expression grammar: `parseStandaloneExpression` plus the full
 * precedence ladder.
 */
export class ExpressionParser extends ClauseParser {
  /**
   * Entry point for `parseExpressionSource`: parses one expression to end of
   * input, over a token stream built from exactly that string (no
   * surrounding block, no stop words). Leading/trailing newlines are
   * harmless and skipped; anything else left over after the expression is a
   * parse error, not a silently-truncated partial parse.
   */
  parseStandaloneExpression(): ResolvedExpression {
    this.skipNewlines();
    const expression = this.parseExpressionUntil(new Set());
    this.skipNewlines();
    if (!this.isAtEnd()) {
      this.failUnexpected("end of expression");
    }
    return expression;
  }

  protected parseExpressionUntil(stopWords: Set<string>): ResolvedExpression {
    if (this.isExpressionStop(stopWords)) {
      this.failExpected("expression", this.current());
    }

    return this.parseCoalesceExpression(stopWords);
  }

  private parseCoalesceExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseOrExpression(stopWords);

    while (!this.isExpressionStop(stopWords) && this.matchSymbol("??")) {
      expression = {
        kind: "binary",
        operator: "??",
        left: expression,
        right: this.parseOrExpression(stopWords),
      };
    }

    return expression;
  }

  private parseOrExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseAndExpression(stopWords);

    while (!this.isExpressionStop(stopWords) && this.matchWord("OR")) {
      expression = {
        kind: "binary",
        operator: "or",
        left: expression,
        right: this.parseAndExpression(stopWords),
      };
    }

    return expression;
  }

  private parseAndExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseEqualityExpression(stopWords);

    while (!this.isExpressionStop(stopWords) && this.matchWord("AND")) {
      expression = {
        kind: "binary",
        operator: "and",
        left: expression,
        right: this.parseEqualityExpression(stopWords),
      };
    }

    return expression;
  }

  private parseEqualityExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseComparisonExpression(stopWords);

    while (!this.isExpressionStop(stopWords)) {
      if (this.matchSymbol("==")) {
        expression = {
          kind: "binary",
          operator: "==",
          left: expression,
          right: this.parseComparisonExpression(stopWords),
        };
      } else if (this.matchSymbol("!=")) {
        expression = {
          kind: "binary",
          operator: "!=",
          left: expression,
          right: this.parseComparisonExpression(stopWords),
        };
      } else {
        break;
      }
    }

    return expression;
  }

  private parseComparisonExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseAdditiveExpression(stopWords);

    while (!this.isExpressionStop(stopWords)) {
      if (this.matchSymbol("<")) {
        expression = {
          kind: "binary",
          operator: "<",
          left: expression,
          right: this.parseAdditiveExpression(stopWords),
        };
      } else if (this.matchSymbol("<=")) {
        expression = {
          kind: "binary",
          operator: "<=",
          left: expression,
          right: this.parseAdditiveExpression(stopWords),
        };
      } else if (this.matchSymbol(">")) {
        expression = {
          kind: "binary",
          operator: ">",
          left: expression,
          right: this.parseAdditiveExpression(stopWords),
        };
      } else if (this.matchSymbol(">=")) {
        expression = {
          kind: "binary",
          operator: ">=",
          left: expression,
          right: this.parseAdditiveExpression(stopWords),
        };
      } else if (this.matchWord("IN")) {
        expression = {
          kind: "binary",
          operator: "in",
          left: expression,
          right: this.parseAdditiveExpression(stopWords),
        };
      } else {
        break;
      }
    }

    return expression;
  }

  private parseAdditiveExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseMultiplicativeExpression(stopWords);

    while (!this.isExpressionStop(stopWords)) {
      if (this.matchSymbol("+")) {
        expression = {
          kind: "binary",
          operator: "+",
          left: expression,
          right: this.parseMultiplicativeExpression(stopWords),
        };
      } else if (this.matchSymbol("-")) {
        expression = {
          kind: "binary",
          operator: "-",
          left: expression,
          right: this.parseMultiplicativeExpression(stopWords),
        };
      } else {
        break;
      }
    }

    return expression;
  }

  private parseMultiplicativeExpression(stopWords: Set<string>): ResolvedExpression {
    let expression = this.parseUnaryExpression(stopWords);

    while (!this.isExpressionStop(stopWords)) {
      if (this.matchSymbol("*")) {
        expression = {
          kind: "binary",
          operator: "*",
          left: expression,
          right: this.parseUnaryExpression(stopWords),
        };
      } else if (this.matchSymbol("/")) {
        expression = {
          kind: "binary",
          operator: "/",
          left: expression,
          right: this.parseUnaryExpression(stopWords),
        };
      } else {
        break;
      }
    }

    return expression;
  }

  private parseUnaryExpression(stopWords: Set<string>): ResolvedExpression {
    if (this.matchWord("NOT")) {
      return {
        kind: "unary",
        operator: "not",
        operand: this.parseUnaryExpression(stopWords),
      };
    }

    if (this.matchSymbol("-")) {
      return {
        kind: "unary",
        operator: "negate",
        operand: this.parseUnaryExpression(stopWords),
      };
    }

    return this.parsePrimaryExpression(stopWords);
  }

  private parsePrimaryExpression(stopWords: Set<string>): ResolvedExpression {
    const token = this.current();

    if (this.matchSymbol("(")) {
      const expression = this.parseCoalesceExpression(stopWords);
      this.expectSymbol(")", "expression group");
      return expression;
    }

    if (token.kind === "string" || token.kind === "number" || token.kind === "boolean") {
      this.advance();
      return {
        kind: "literal",
        value: token.value as string | number | boolean,
      };
    }

    if (this.matchWord("NULL")) {
      return { kind: "literal", value: null };
    }

    if (token.kind === "identifier") {
      const first = this.advance().lexeme;
      if (this.matchSymbol(".")) {
        const property = this.consumeWordLexeme("runtime expression property");
        if (normaliseKeyword(first) !== "runtime") {
          this.failExpected("runtime expression reference", token);
        }
        if (property === "userId" || property === "now") {
          return { kind: "runtime", property };
        }
        return { kind: "runtime", property: property as ExpressionRuntimeProperty };
      }
      return { kind: "field", field: first };
    }

    this.failExpected("expression value", this.current());
  }

  private isExpressionStop(stopWords: Set<string>): boolean {
    return this.isLineEnd() || this.checkSymbol(")") || this.currentWordIsAny(stopWords);
  }
}
