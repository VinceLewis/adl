import type {
  PresentationDensity,
  PresentationFormatKind,
  PresentationFragmentStyle,
  PresentationLegendInclude,
  PresentationLayout,
  PresentationActionPlacement,
  PresentationCalendarWeekStart,
  PresentationListRenderStyle,
  PresentationRowLayout,
  PresentationStatusThemeToken,
  PresentationStatePersistence,
  PresentationStateType,
} from "../../model/resolved-model.js";
import type { PresentationIconRefDeclarationAst } from "../ast.js";
import type { Token } from "../lexer.js";
import { normaliseKeyword } from "./text.js";
import { LifecycleParser } from "./lifecycle.js";

/**
 * Leaf presentation enums and scalars — the shared bottom layer of the
 * presentation cluster, which is what keeps the other presentation files
 * free of cycles.
 */
export class PresentationScalarParser extends LifecycleParser {
  protected parsePresentationLayout(): PresentationLayout {
    const token = this.consumeWordToken("presentation layout");

    switch (normaliseKeyword(token.lexeme)) {
      case "stack":
        return "stack";
      case "grid":
        return "grid";
      case "split":
        return "split";
      case "sidebar":
        return "sidebar";
      default:
        this.failExpected("presentation layout STACK, GRID, SPLIT, or SIDEBAR", token);
    }
  }

  protected parsePresentationDensity(): PresentationDensity {
    const token = this.consumeWordToken("presentation density");

    switch (normaliseKeyword(token.lexeme)) {
      case "compact":
        return "compact";
      case "comfortable":
        return "comfortable";
      case "spacious":
        return "spacious";
      default:
        this.failExpected("presentation density COMPACT, COMFORTABLE, or SPACIOUS", token);
    }
  }

  protected parsePresentationStateType(): PresentationStateType {
    const token = this.consumeWordToken("presentation state type");

    switch (normaliseKeyword(token.lexeme)) {
      case "text":
        return "text";
      case "number":
      case "num":
        return "number";
      case "date":
        return "date";
      case "datetime":
        return "datetime";
      case "time":
        return "time";
      case "boolean":
      case "bool":
        return "boolean";
      default:
        this.failExpected(
          "presentation state type TEXT, NUMBER, DATE, DATETIME, TIME, or BOOLEAN",
          token,
        );
    }
  }

  protected parsePresentationStatePersistence(): PresentationStatePersistence {
    const token = this.consumeWordToken("presentation state persistence");

    switch (normaliseKeyword(token.lexeme)) {
      case "memory":
        return "memory";
      case "session":
        return "session";
      case "local":
        return "local";
      default:
        this.failExpected("presentation state persistence MEMORY, SESSION, or LOCAL", token);
    }
  }

  protected parsePresentationCalendarWeekStart(): PresentationCalendarWeekStart {
    const token = this.consumeWordToken("calendar week start");

    switch (normaliseKeyword(token.lexeme)) {
      case "sunday":
        return "sunday";
      case "monday":
        return "monday";
      case "tuesday":
        return "tuesday";
      case "wednesday":
        return "wednesday";
      case "thursday":
        return "thursday";
      case "friday":
        return "friday";
      case "saturday":
        return "saturday";
      default:
        this.failExpected(
          "calendar week start SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, or SATURDAY",
          token,
        );
    }
  }

  protected parsePresentationListRenderStyle(): PresentationListRenderStyle {
    const token = this.consumeWordToken("presentation list render style");

    switch (normaliseKeyword(token.lexeme)) {
      case "table":
        return "table";
      case "feed":
        return "feed";
      case "compactfeed":
        return "compactFeed";
      case "cards":
        return "cards";
      default:
        this.failExpected(
          "presentation list render style TABLE, FEED, COMPACT_FEED, or CARDS",
          token,
        );
    }
  }

  protected parsePresentationRowLayout(): PresentationRowLayout {
    const token = this.consumeWordToken("presentation row layout");

    switch (normaliseKeyword(token.lexeme)) {
      case "inline":
        return "inline";
      case "stack":
        return "stack";
      default:
        this.failExpected("presentation row layout INLINE or STACK", token);
    }
  }

  protected parsePresentationActionPlacement(): PresentationActionPlacement {
    const token = this.consumeWordToken("presentation action placement");
    switch (normaliseKeyword(token.lexeme)) {
      case "primary":
        return "primary";
      case "secondary":
        return "secondary";
      case "row":
        return "row";
      default:
        this.failExpected("presentation action placement PRIMARY, SECONDARY, or ROW", token);
    }
  }

  protected parsePresentationStatusThemeToken(): PresentationStatusThemeToken {
    const token = this.consumeWordToken("presentation status theme token");

    switch (normaliseKeyword(token.lexeme)) {
      case "statusevent":
      case "colorstatusevent":
        return "colorStatusEvent";
      case "statusalternate":
      case "colorstatusalternate":
        return "colorStatusAlternate";
      case "statusavailable":
      case "colorstatusavailable":
        return "colorStatusAvailable";
      case "statusunavailable":
      case "colorstatusunavailable":
        return "colorStatusUnavailable";
      case "statusbusyelsewhere":
      case "colorstatusbusyelsewhere":
        return "colorStatusBusyElsewhere";
      case "statusconflict":
      case "colorstatusconflict":
        return "colorStatusConflict";
      case "statusunset":
      case "colorstatusunset":
        return "colorStatusUnset";
      case "info":
      case "colorinfo":
        return "colorInfo";
      default:
        this.failExpected("presentation status theme token", token);
    }
  }

  protected parsePresentationLegendInclude(): PresentationLegendInclude {
    const token = this.consumeWordToken("presentation legend include mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "present":
        return "present";
      case "all":
        return "all";
      default:
        this.failExpected("presentation legend include mode PRESENT or ALL", token);
    }
  }

  protected parsePresentationFragmentStyle(): PresentationFragmentStyle {
    const token = this.consumeWordToken("presentation fragment style");

    switch (normaliseKeyword(token.lexeme)) {
      case "plain":
        return "plain";
      case "bold":
        return "bold";
      case "muted":
        return "muted";
      case "caption":
        return "caption";
      default:
        this.failExpected("presentation fragment style PLAIN, BOLD, MUTED, or CAPTION", token);
    }
  }

  protected parsePresentationFormat(): { kind: PresentationFormatKind; pattern?: string } {
    if (this.current().kind === "string") {
      return {
        kind: "text",
        pattern: String(this.consumeLiteral("presentation format pattern")),
      };
    }

    const token = this.consumeWordToken("presentation format kind or pattern");
    const kind = this.normalisePresentationFormatKind(token);

    if (this.isLineEnd()) {
      return { kind };
    }

    return {
      kind,
      pattern: String(this.consumeLiteral("presentation format pattern")),
    };
  }

  private normalisePresentationFormatKind(token: Token): PresentationFormatKind {
    switch (normaliseKeyword(token.lexeme)) {
      case "text":
        return "text";
      case "number":
        return "number";
      case "date":
        return "date";
      case "datetime":
        return "datetime";
      case "time":
        return "time";
      case "duration":
        return "duration";
      default:
        return "text";
    }
  }

  protected parsePresentationIconRef(
    argumentMode: "field" | "value",
  ): PresentationIconRefDeclarationAst {
    const name = this.consumeName("presentation icon name or map");

    if (!this.matchSymbol("(")) {
      return { kind: "named", name };
    }

    if (this.matchWord("FIELD")) {
      const field = this.consumeName("presentation icon map field");
      this.expectSymbol(")", "presentation icon map reference");
      return { kind: "map", map: name, field };
    }

    if (this.matchWord("VALUE")) {
      const value = this.consumePrimitiveLiteral("presentation icon map value");
      this.expectSymbol(")", "presentation icon map reference");
      return { kind: "map", map: name, value };
    }

    const token = this.current();
    if (argumentMode === "field" && token.kind === "identifier") {
      const field = this.consumeName("presentation icon map field");
      this.expectSymbol(")", "presentation icon map reference");
      return { kind: "map", map: name, field };
    }

    const value = this.consumePrimitiveLiteral("presentation icon map value");
    this.expectSymbol(")", "presentation icon map reference");
    return { kind: "map", map: name, value };
  }
}
