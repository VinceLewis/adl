import type {
  PresentationDensity,
  PresentationFormatKind,
  PresentationFragmentStyle,
  PresentationRowLayout,
} from "../../model/resolved-model.js";
import type {
  PresentationRowFragmentDeclarationAst,
  PresentationRowTemplateDeclarationAst,
} from "../ast.js";
import { PresentationScalarParser } from "./presentation-scalars.js";

/**
 * Presentation row templates and their text/icon fragments.
 */
export class PresentationRowFormatParser extends PresentationScalarParser {
  protected parsePresentationRowTemplate(): PresentationRowTemplateDeclarationAst {
    const startToken = this.expectWord("ROW", "ROW declaration");
    let layout: PresentationRowLayout | undefined;
    let density: PresentationDensity | undefined;
    const fragments: PresentationRowFragmentDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("LAYOUT")) {
        layout = this.parsePresentationRowLayout();
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
      } else {
        this.failUnexpected("ROW header option LAYOUT, DENSITY, or end of line");
      }
    }
    this.consumeLineEnd("ROW declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ROW", this.current());
      }

      if (this.checkEnd("ROW")) {
        const end = this.parseEnd("ROW");
        return {
          kind: "PresentationRowTemplateDeclaration",
          ...(layout === undefined ? {} : { layout }),
          ...(density === undefined ? {} : { density }),
          fragments,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("TEXT")) {
        fragments.push(this.parsePresentationTextFragment());
      } else if (this.checkWord("ICON")) {
        fragments.push(this.parsePresentationIconFragment());
      } else if (this.checkWord("END")) {
        this.failExpected("END.ROW", this.current());
      } else {
        this.failUnexpected("ROW directive TEXT, ICON, or END.ROW");
      }
    }
  }

  private parsePresentationTextFragment(): PresentationRowFragmentDeclarationAst {
    const startToken = this.expectWord("TEXT", "TEXT row fragment");
    const token = this.current();
    const isLiteral = token.kind === "string";
    const value = isLiteral
      ? String(this.consumeLiteral("TEXT literal"))
      : this.consumeName("TEXT field or literal");
    let style: PresentationFragmentStyle | undefined;
    let format: { kind: PresentationFormatKind; pattern?: string } | undefined;
    let fallback: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("STYLE")) {
        style = this.parsePresentationFragmentStyle();
      } else if (this.matchWord("FORMAT")) {
        format = this.parsePresentationFormat();
      } else if (this.matchWord("FALLBACK")) {
        fallback = String(this.consumeLiteral("TEXT FALLBACK value"));
      } else {
        this.failUnexpected("TEXT option FORMAT, FALLBACK, STYLE, or end of line");
      }
    }
    this.consumeLineEnd("TEXT row fragment");

    // `FALLBACK` says what to render when a *field* is null, so it is
    // meaningless on a literal fragment and refused rather than dropped.
    if (isLiteral && fallback !== undefined) {
      this.failExpected("TEXT field fragment for FALLBACK", startToken);
    }

    if (isLiteral) {
      return {
        kind: "PresentationLiteralTextFragmentDeclaration",
        text: value,
        ...(style === undefined ? {} : { style }),
        range: this.rangeFrom(startToken),
      };
    }

    return {
      kind: "PresentationFieldTextFragmentDeclaration",
      field: value,
      ...(style === undefined ? {} : { style }),
      ...(format === undefined ? {} : { format }),
      ...(fallback === undefined ? {} : { fallback }),
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationIconFragment(): PresentationRowFragmentDeclarationAst {
    const startToken = this.expectWord("ICON", "ICON row fragment");
    const icon = this.parsePresentationIconRef("field");
    let label: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("ICON label"));
      } else {
        this.failUnexpected("ICON option LABEL or end of line");
      }
    }

    this.consumeLineEnd("ICON row fragment");
    return {
      kind: "PresentationIconFragmentDeclaration",
      icon,
      ...(label === undefined ? {} : { label }),
      range: this.rangeFrom(startToken),
    };
  }
}
