import type {
  PresentationActionPlacement,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type {
  PresentationActionControlDeclarationAst,
  PresentationActionInputDeclarationAst,
  PresentationIconRefDeclarationAst,
} from "../ast.js";
import { PresentationRowFormatParser } from "./presentation-row-format.js";

/**
 * Presentation action controls and their inputs.
 */
export class PresentationActionParser extends PresentationRowFormatParser {
  protected parsePresentationAction(
    defaultPlacement?: PresentationActionPlacement,
  ): PresentationActionControlDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("ACTION", "presentation ACTION declaration");
    const name = this.consumeName("presentation action name");
    let label: string | undefined;
    let icon: PresentationIconRefDeclarationAst | undefined;
    let placement: PresentationActionPlacement | undefined = defaultPlacement;
    let command: string | undefined;
    let view: string | undefined;
    let createObject: string | undefined;
    let createView: string | undefined;
    let visibleWhen: ResolvedExpression | undefined;
    const input: PresentationActionInputDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("presentation action label"));
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
      } else if (this.matchWord("PLACEMENT")) {
        placement = this.parsePresentationActionPlacement();
      } else if (this.matchWord("COMMAND")) {
        command = this.consumeName("presentation action command");
      } else if (this.matchWord("VIEW")) {
        view = this.consumeName("presentation action target view");
      } else if (this.matchWord("CREATE")) {
        createObject = this.consumeName("presentation action create object");
      } else if (this.matchWord("FORM")) {
        createView = this.consumeName("presentation action create form view");
      } else if (this.matchWord("WHEN")) {
        visibleWhen = this.parseExpressionUntil(new Set());
      } else {
        this.failUnexpected(
          "ACTION header option LABEL, ICON, PLACEMENT, COMMAND, VIEW, CREATE, FORM, WHEN, or end of line",
        );
      }
    }
    this.consumeLineEnd("presentation ACTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ACTION", this.current());
      }

      if (this.checkEnd("ACTION")) {
        const end = this.parseEnd("ACTION");
        return {
          kind: "PresentationActionControlDeclaration",
          name,
          ...(label === undefined ? {} : { label }),
          ...(icon === undefined ? {} : { icon }),
          ...(placement === undefined ? {} : { placement }),
          ...(command === undefined ? {} : { command }),
          ...(view === undefined ? {} : { view }),
          ...(createObject === undefined ? {} : { createObject }),
          ...(createView === undefined ? {} : { createView }),
          input,
          ...(visibleWhen === undefined ? {} : { visibleWhen }),
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("presentation action label"));
        this.consumeLineEnd("ACTION LABEL directive");
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
        this.consumeLineEnd("ACTION ICON directive");
      } else if (this.matchWord("PLACEMENT")) {
        placement = this.parsePresentationActionPlacement();
        this.consumeLineEnd("ACTION PLACEMENT directive");
      } else if (this.matchWord("COMMAND")) {
        command = this.consumeName("presentation action command");
        this.consumeLineEnd("ACTION COMMAND directive");
      } else if (this.matchWord("VIEW")) {
        view = this.consumeName("presentation action target view");
        this.consumeLineEnd("ACTION VIEW directive");
      } else if (this.matchWord("CREATE")) {
        createObject = this.consumeName("presentation action create object");
        this.consumeLineEnd("ACTION CREATE directive");
      } else if (this.matchWord("FORM")) {
        createView = this.consumeName("presentation action create form view");
        this.consumeLineEnd("ACTION FORM directive");
      } else if (this.matchWord("INPUT")) {
        input.push(this.parsePresentationActionInput());
      } else if (this.matchWord("WHEN")) {
        visibleWhen = this.parseExpressionUntil(new Set());
        this.consumeLineEnd("ACTION WHEN directive");
      } else {
        this.failUnexpected(
          "ACTION directive LABEL, ICON, PLACEMENT, COMMAND, VIEW, CREATE, FORM, INPUT, WHEN, or END.ACTION",
        );
      }
    }
  }

  private parsePresentationActionInput(): PresentationActionInputDeclarationAst {
    const startToken = this.previous();
    const name = this.consumeName("presentation action input name");
    this.expectWord("FROM", "ACTION INPUT FROM clause");
    const expression = this.parseExpressionUntil(new Set());
    this.consumeLineEnd("ACTION INPUT directive");
    return {
      kind: "PresentationActionInputDeclaration",
      name,
      expression,
      range: this.rangeFrom(startToken),
    };
  }
}
