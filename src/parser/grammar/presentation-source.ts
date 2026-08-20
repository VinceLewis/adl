import type {
  PresentationDensity,
  PresentationCalendarSourceKind,
  PresentationCalendarWeekStart,
  PresentationListRenderStyle,
  PresentationListSourceKind,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type {
  PresentationActionControlDeclarationAst,
  PresentationCalendarConflictOverlayDeclarationAst,
  PresentationCalendarDeclarationAst,
  PresentationFormatDeclarationAst,
  PresentationIconRefDeclarationAst,
  PresentationListDeclarationAst,
  PresentationRowTemplateDeclarationAst,
  PresentationStatusCandidateDeclarationAst,
  SortDeclarationAst,
} from "../ast.js";
import { PresentationActionParser } from "./presentation-action.js";

/**
 * Presentation data sources: `LIST`, `CALENDAR` and their status candidates.
 */
export class PresentationSourceParser extends PresentationActionParser {
  protected parsePresentationList(): PresentationListDeclarationAst {
    const startToken = this.expectWord("LIST", "LIST declaration");
    const name = this.consumeName("list name");
    this.expectWord("FROM", "LIST FROM clause");
    let sourceKind: PresentationListSourceKind | undefined;

    if (this.matchWord("OBJECT")) {
      sourceKind = "object";
    } else if (this.matchUnderscoreOrDottedWord("FROM READ_MODEL", "READ_MODEL", "READ", "MODEL")) {
      sourceKind = "readModel";
    }

    const source = this.consumeName("list source");
    let renderAs: PresentationListRenderStyle | undefined;
    let density: PresentationDensity | undefined;
    const fields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    let filter: ResolvedExpression | undefined;
    let emptyText: string | undefined;
    let emptyIcon: PresentationIconRefDeclarationAst | undefined;
    const statusCandidates: PresentationStatusCandidateDeclarationAst[] = [];
    const actions: PresentationActionControlDeclarationAst[] = [];
    let row: PresentationRowTemplateDeclarationAst | undefined;
    this.consumeLineEnd("LIST declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.LIST", this.current());
      }

      if (this.checkEnd("LIST")) {
        const end = this.parseEnd("LIST");
        return {
          kind: "PresentationListDeclaration",
          name,
          ...(sourceKind === undefined ? {} : { sourceKind }),
          source,
          ...(renderAs === undefined ? {} : { renderAs }),
          ...(density === undefined ? {} : { density }),
          fields,
          sort,
          ...(filter === undefined ? {} : { filter }),
          ...(emptyText === undefined ? {} : { emptyText }),
          ...(emptyIcon === undefined ? {} : { emptyIcon }),
          statusCandidates,
          actions,
          ...(row === undefined ? {} : { row }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilLine("list fields"));
        this.consumeLineEnd("LIST FIELDS directive");
      } else if (this.matchWord("ORDER")) {
        this.expectWord("BY", "LIST ORDER BY clause");
        sort.push(...this.parseSortList());
        this.consumeLineEnd("LIST ORDER BY directive");
      } else if (this.matchWord("WHERE")) {
        filter = this.parseExpressionUntil(new Set());
        this.consumeLineEnd("LIST WHERE directive");
      } else if (this.matchUnderscoreOrDottedWord("LIST RENDER_AS", "RENDER_AS", "RENDER", "AS")) {
        renderAs = this.parsePresentationListRenderStyle();
        this.consumeLineEnd("LIST RENDER_AS directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("LIST DENSITY directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("LIST EMPTY_TEXT value"));
        this.consumeLineEnd("LIST EMPTY_TEXT directive");
      } else if (this.matchWord("EMPTY_ICON")) {
        emptyIcon = this.parsePresentationIconRef("value");
        this.consumeLineEnd("LIST EMPTY_ICON directive");
      } else if (this.checkWord("STATUS")) {
        statusCandidates.push(this.parsePresentationStatusCandidate());
      } else if (this.checkWord("ACTION")) {
        actions.push(this.parsePresentationAction("row"));
      } else if (this.checkWord("ROW")) {
        row = this.parsePresentationRowTemplate();
      } else if (this.checkWord("END")) {
        this.failExpected("END.LIST", this.current());
      } else {
        this.failUnexpected(
          "LIST directive FIELDS, ORDER BY, WHERE, RENDER_AS, DENSITY, EMPTY_TEXT, EMPTY_ICON, STATUS, ACTION, ROW, or END.LIST",
        );
      }
    }
  }

  protected parsePresentationCalendar(): PresentationCalendarDeclarationAst {
    const startToken = this.expectWord("CALENDAR", "CALENDAR declaration");
    const name = this.consumeName("calendar name");
    this.expectWord("FROM", "CALENDAR FROM clause");
    let sourceKind: PresentationCalendarSourceKind | undefined;

    if (this.matchWord("OBJECT")) {
      sourceKind = "object";
    } else if (this.matchUnderscoreOrDottedWord("FROM READ_MODEL", "READ_MODEL", "READ", "MODEL")) {
      sourceKind = "readModel";
    }

    const source = this.consumeName("calendar source");
    let dateField: string | undefined;
    let titleField: string | undefined;
    let density: PresentationDensity | undefined;
    let monthValue: string | undefined;
    let monthState: string | undefined;
    let weekStart: PresentationCalendarWeekStart | undefined;
    let monthLabelFormat: PresentationFormatDeclarationAst | undefined;
    let minDate: string | undefined;
    let maxDate: string | undefined;
    let emptyText: string | undefined;
    let emptyIcon: PresentationIconRefDeclarationAst | undefined;
    let conflictOverlay: PresentationCalendarConflictOverlayDeclarationAst | undefined;
    const summaryFields: string[] = [];
    const fields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    const statusCandidates: PresentationStatusCandidateDeclarationAst[] = [];
    const actions: PresentationActionControlDeclarationAst[] = [];
    this.consumeLineEnd("CALENDAR declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.CALENDAR", this.current());
      }

      if (this.checkEnd("CALENDAR")) {
        const end = this.parseEnd("CALENDAR");
        return {
          kind: "PresentationCalendarDeclaration",
          name,
          ...(sourceKind === undefined ? {} : { sourceKind }),
          source,
          ...(dateField === undefined ? {} : { dateField }),
          ...(titleField === undefined ? {} : { titleField }),
          summaryFields,
          fields,
          sort,
          ...(density === undefined ? {} : { density }),
          ...(monthValue === undefined ? {} : { monthValue }),
          ...(monthState === undefined ? {} : { monthState }),
          ...(weekStart === undefined ? {} : { weekStart }),
          ...(monthLabelFormat === undefined ? {} : { monthLabelFormat }),
          ...(minDate === undefined ? {} : { minDate }),
          ...(maxDate === undefined ? {} : { maxDate }),
          statusCandidates,
          actions,
          ...(emptyText === undefined ? {} : { emptyText }),
          ...(emptyIcon === undefined ? {} : { emptyIcon }),
          ...(conflictOverlay === undefined ? {} : { conflictOverlay }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchUnderscoreOrDottedWord("CALENDAR DATE_FIELD", "DATE_FIELD", "DATE", "FIELD")) {
        dateField = this.consumeName("CALENDAR DATE_FIELD value");
        this.consumeLineEnd("CALENDAR DATE_FIELD directive");
      } else if (
        this.matchUnderscoreOrDottedWord("CALENDAR TITLE_FIELD", "TITLE_FIELD", "TITLE", "FIELD")
      ) {
        titleField = this.consumeName("CALENDAR TITLE_FIELD value");
        this.consumeLineEnd("CALENDAR TITLE_FIELD directive");
      } else if (
        this.matchUnderscoreOrDottedWord(
          "CALENDAR SUMMARY_FIELDS",
          "SUMMARY_FIELDS",
          "SUMMARY",
          "FIELDS",
        )
      ) {
        summaryFields.push(...this.consumeNameListUntilLine("calendar summary fields"));
        this.consumeLineEnd("CALENDAR SUMMARY_FIELDS directive");
      } else if (this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilLine("calendar fields"));
        this.consumeLineEnd("CALENDAR FIELDS directive");
      } else if (this.matchWord("ORDER")) {
        this.expectWord("BY", "CALENDAR ORDER BY clause");
        sort.push(...this.parseSortList());
        this.consumeLineEnd("CALENDAR ORDER BY directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("CALENDAR DENSITY directive");
      } else if (this.matchWord("MONTH")) {
        monthValue = String(this.consumeLiteral("CALENDAR MONTH value"));
        this.consumeLineEnd("CALENDAR MONTH directive");
      } else if (
        this.matchUnderscoreOrDottedWord("CALENDAR MONTH_STATE", "MONTH_STATE", "MONTH", "STATE")
      ) {
        monthState = this.consumeName("CALENDAR MONTH_STATE value");
        this.consumeLineEnd("CALENDAR MONTH_STATE directive");
      } else if (
        this.matchUnderscoreOrDottedWord("CALENDAR WEEK_START", "WEEK_START", "WEEK", "START")
      ) {
        weekStart = this.parsePresentationCalendarWeekStart();
        this.consumeLineEnd("CALENDAR WEEK_START directive");
      } else if (this.matchWord("MONTH_LABEL_FORMAT")) {
        monthLabelFormat = this.parsePresentationFormat();
        this.consumeLineEnd("CALENDAR MONTH_LABEL_FORMAT directive");
      } else if (this.matchWord("RANGE")) {
        minDate = String(this.consumeLiteral("CALENDAR RANGE start"));
        this.expectWord("TO", "CALENDAR RANGE TO clause");
        maxDate = String(this.consumeLiteral("CALENDAR RANGE end"));
        this.consumeLineEnd("CALENDAR RANGE directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("CALENDAR EMPTY_TEXT value"));
        this.consumeLineEnd("CALENDAR EMPTY_TEXT directive");
      } else if (this.matchWord("EMPTY_ICON")) {
        emptyIcon = this.parsePresentationIconRef("value");
        this.consumeLineEnd("CALENDAR EMPTY_ICON directive");
      } else if (this.checkWord("CONFLICT_OVERLAY")) {
        conflictOverlay = this.parsePresentationCalendarConflictOverlay();
      } else if (this.checkWord("STATUS")) {
        statusCandidates.push(this.parsePresentationStatusCandidate());
      } else if (this.checkWord("ACTION")) {
        actions.push(this.parsePresentationAction("secondary"));
      } else if (this.checkWord("END")) {
        this.failExpected("END.CALENDAR", this.current());
      } else {
        this.failUnexpected(
          "CALENDAR directive DATE_FIELD, TITLE_FIELD, SUMMARY_FIELDS, FIELDS, ORDER BY, DENSITY, MONTH, MONTH_STATE, WEEK_START, MONTH_LABEL_FORMAT, RANGE, EMPTY_TEXT, EMPTY_ICON, CONFLICT_OVERLAY, STATUS, ACTION, or END.CALENDAR",
        );
      }
    }
  }

  /**
   * ```adl
   * CONFLICT_OVERLAY FROM READ_MODEL EventAvailabilityConflicts
   *   DATE_FIELD Date
   *   FLAG_FIELD IsConflict
   *   STATUS conflict
   * END.CONFLICT_OVERLAY
   * ```
   *
   * Block form rather than one long header line, because it carries four
   * clauses and every other multi-clause presentation construct here (`LIST`,
   * `CALENDAR`, `PICKER`, `TOGGLE`, `ACTION`) is a block. `FROM READ_MODEL`
   * mirrors the calendar's own header even though a read model is the only
   * thing an overlay can be bound to: the overlay exists precisely because it
   * is a *second* read model, and spelling that out is what distinguishes it
   * from the calendar's `source` directly above it.
   */
  private parsePresentationCalendarConflictOverlay(): PresentationCalendarConflictOverlayDeclarationAst {
    const startToken = this.expectWord("CONFLICT_OVERLAY", "CONFLICT_OVERLAY declaration");
    this.expectWord("FROM", "CONFLICT_OVERLAY FROM clause");
    this.expectUnderscoreOrDottedWord(
      "CONFLICT_OVERLAY FROM READ_MODEL",
      "READ_MODEL",
      "READ",
      "MODEL",
      "CONFLICT_OVERLAY FROM clause",
    );
    const readModel = this.consumeName("conflict overlay read model");
    let dateField: string | undefined;
    let flagField: string | undefined;
    let status: string | undefined;
    this.consumeLineEnd("CONFLICT_OVERLAY declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.CONFLICT_OVERLAY", this.current());
      }

      if (this.checkEnd("CONFLICT_OVERLAY")) {
        const end = this.parseEnd("CONFLICT_OVERLAY");

        // All three are required by `ResolvedPresentationCalendarConflictOverlay`,
        // which declares none of them optional, so an incomplete block is
        // refused here rather than producing a partial model no resolver can
        // complete.
        if (dateField === undefined) {
          this.failExpected("CONFLICT_OVERLAY DATE_FIELD directive", this.previous());
        }
        if (flagField === undefined) {
          this.failExpected("CONFLICT_OVERLAY FLAG_FIELD directive", this.previous());
        }
        if (status === undefined) {
          this.failExpected("CONFLICT_OVERLAY STATUS directive", this.previous());
        }

        return {
          kind: "PresentationCalendarConflictOverlayDeclaration",
          readModel,
          dateField,
          flagField,
          status,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (
        this.matchUnderscoreOrDottedWord(
          "CONFLICT_OVERLAY DATE_FIELD",
          "DATE_FIELD",
          "DATE",
          "FIELD",
        )
      ) {
        dateField = this.consumeName("CONFLICT_OVERLAY DATE_FIELD value");
        this.consumeLineEnd("CONFLICT_OVERLAY DATE_FIELD directive");
      } else if (
        this.matchUnderscoreOrDottedWord(
          "CONFLICT_OVERLAY FLAG_FIELD",
          "FLAG_FIELD",
          "FLAG",
          "FIELD",
        )
      ) {
        flagField = this.consumeName("CONFLICT_OVERLAY FLAG_FIELD value");
        this.consumeLineEnd("CONFLICT_OVERLAY FLAG_FIELD directive");
      } else if (this.matchWord("STATUS")) {
        status = this.consumeName("CONFLICT_OVERLAY STATUS value");
        this.consumeLineEnd("CONFLICT_OVERLAY STATUS directive");
      } else {
        this.failUnexpected(
          "CONFLICT_OVERLAY directive DATE_FIELD, FLAG_FIELD, STATUS, or END.CONFLICT_OVERLAY",
        );
      }
    }
  }

  private parsePresentationStatusCandidate(): PresentationStatusCandidateDeclarationAst {
    const startToken = this.expectWord("STATUS", "LIST STATUS directive");
    const name = this.consumeName("presentation status name or map");

    if (!this.matchSymbol("(")) {
      this.consumeLineEnd("LIST STATUS directive");
      return {
        kind: "direct",
        status: name,
        range: this.rangeFrom(startToken),
      };
    }

    if (this.matchWord("FIELD")) {
      const field = this.consumeName("presentation status map field");
      this.expectSymbol(")", "presentation status map reference");
      this.consumeLineEnd("LIST STATUS directive");
      return {
        kind: "map",
        map: name,
        field,
        range: this.rangeFrom(startToken),
      };
    }

    if (this.matchWord("VALUE")) {
      const value = this.consumePrimitiveLiteral("presentation status map value");
      this.expectSymbol(")", "presentation status map reference");
      this.consumeLineEnd("LIST STATUS directive");
      return {
        kind: "map",
        map: name,
        value,
        range: this.rangeFrom(startToken),
      };
    }

    const token = this.current();
    if (token.kind === "identifier") {
      const field = this.consumeName("presentation status map field");
      this.expectSymbol(")", "presentation status map reference");
      this.consumeLineEnd("LIST STATUS directive");
      return {
        kind: "map",
        map: name,
        field,
        range: this.rangeFrom(startToken),
      };
    }

    const value = this.consumePrimitiveLiteral("presentation status map value");
    this.expectSymbol(")", "presentation status map reference");
    this.consumeLineEnd("LIST STATUS directive");
    return {
      kind: "map",
      map: name,
      value,
      range: this.rangeFrom(startToken),
    };
  }
}
