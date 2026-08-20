import type { ViewContextMode } from "../../model/resolved-model.js";
import type { SortDeclarationAst, ViewContextDeclarationAst } from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { LiteralParser } from "./literals.js";

/**
 * Small clauses shared by more than one grammar area, and only those.
 */
export class ClauseParser extends LiteralParser {
  /**
   * A flag directive that means `true` when written alone.
   *
   * `STAGED` and `EXCLUDE_LINKED` both default to `true` in the resolved model,
   * so the bare form has to mean `true` for the word to read as English. The
   * explicit form exists because turning one *off* is otherwise unsayable.
   */
  protected parseOptionalBoolean(): boolean {
    return this.isLineEnd() ? true : this.consumeBooleanValue("boolean value");
  }

  protected parseViewContextAfterKeyword(): ViewContextDeclarationAst {
    const mode = this.parseViewContextMode();
    if (mode === "none") {
      return { mode };
    }

    const context = this.consumeName("view context name");
    return { mode, context };
  }

  private parseViewContextMode(): ViewContextMode {
    const token = this.consumeWordToken("view context mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "none":
        return "none";
      case "required":
      case "current":
      case "currentcontext":
        return "required";
      case "optional":
        return "optional";
      case "all":
      case "allcontexts":
        return "all";
      default:
        this.failExpected("view context mode NONE, REQUIRED, OPTIONAL, or ALL", token);
    }
  }

  protected parseSortList(): SortDeclarationAst[] {
    const sort: SortDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      this.skipComma();
      if (this.isLineEnd()) {
        break;
      }
      const startToken = this.current();
      const field = this.consumeName("sort field");
      let direction: "asc" | "desc" = "asc";

      if (this.matchWord("ASC")) {
        direction = "asc";
      } else if (this.matchWord("DESC")) {
        direction = "desc";
      }

      sort.push({
        kind: "SortDeclaration",
        field,
        direction,
        range: { start: startToken.range.start, end: this.previous().range.end },
      });
    }

    return sort;
  }
}
