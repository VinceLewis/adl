import type {
  JsonPrimitive,
  PresentationDensity,
  PresentationCalendarSourceKind,
  PresentationCalendarWeekStart,
  PresentationListRenderStyle,
  PresentationListSourceKind,
  PresentationMatrixBulkBehavior,
  PresentationMatrixSourceKind,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type {
  PresentationActionControlDeclarationAst,
  PresentationCalendarConflictOverlayDeclarationAst,
  PresentationCalendarDeclarationAst,
  PresentationFormatDeclarationAst,
  PresentationIconRefDeclarationAst,
  PresentationListDeclarationAst,
  PresentationMatrixAxisSourceDeclarationAst,
  PresentationMatrixCellDeclarationAst,
  PresentationMatrixCellSourceDeclarationAst,
  PresentationMatrixDateColumnAxisDeclarationAst,
  PresentationMatrixDeclarationAst,
  PresentationMatrixEditDeclarationAst,
  PresentationRowTemplateDeclarationAst,
  PresentationStatusCandidateDeclarationAst,
  SortDeclarationAst,
} from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { PresentationActionParser } from "./presentation-action.js";

/**
 * Presentation data sources: `LIST`, `CALENDAR`, `MATRIX` and their status
 * candidates.
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

  /**
   * ```adl
   * MATRIX AvailabilityMatrix
   *   DENSITY COMPACT
   *   ROWS FROM OBJECT Member
   *     KEY MemberKey
   *     LABEL MemberName
   *   END.ROWS
   *   COLUMNS DATE_RANGE '2026-03-02' TO '2026-03-06' STEP_DAYS 3
   *   CELLS FROM OBJECT Availability ROW MemberKey COLUMN Day
   *     STATUS StateStatus(FIELD State)
   *   END.CELLS
   *   CELL
   *     UNSET_STATUS unset
   *   END.CELL
   *   EDIT Availability ROW MemberKey COLUMN Day VALUE State
   *     CYCLE 'available' 'unavailable'
   *     UNSET_AS_ABSENCE
   *   END.EDIT
   * END.MATRIX
   * ```
   *
   * `ROWS`, `CELLS`, `CELL` and `EDIT` are blocks by the rule Phase 100 set —
   * a multi-clause construct gets an `END.X` terminator, a simple record stays
   * on one line — which is also the only way to keep `rowSource.fields` and
   * `cellSource.fields` apart: they are different lists, and a flat `MATRIX`
   * body could not distinguish them without a prefix on roughly a dozen
   * directives. `COLUMNS` stays a single line for the converse reason.
   *
   * Phase 104. `docs/spec/ui-language-addendum.md` sketched a syntax for this
   * from Phase 29 onward that was never compilable; see
   * `docs/phases/phase-104-matrix-text-syntax.md` for the clause-by-clause
   * amendments and why each was needed.
   */
  protected parsePresentationMatrix(): PresentationMatrixDeclarationAst {
    const startToken = this.expectWord("MATRIX", "MATRIX declaration");
    const name = this.consumeName("matrix name");
    let density: PresentationDensity | undefined;
    let rowSource: PresentationMatrixAxisSourceDeclarationAst | undefined;
    let columnAxis: PresentationMatrixDateColumnAxisDeclarationAst | undefined;
    let cellSource: PresentationMatrixCellSourceDeclarationAst | undefined;
    let cell: PresentationMatrixCellDeclarationAst | undefined;
    let edit: PresentationMatrixEditDeclarationAst | undefined;
    this.consumeLineEnd("MATRIX declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.MATRIX", this.current());
      }

      if (this.checkEnd("MATRIX")) {
        const end = this.parseEnd("MATRIX");

        // `rowSource`, `columnAxis` and `cellSource` are all non-optional in
        // `PartialPresentationMatrixModel`; refuse here rather than hand the
        // resolver a shape it cannot complete.
        if (rowSource === undefined) {
          this.failExpected("MATRIX ROWS block", this.previous());
        }
        if (columnAxis === undefined) {
          this.failExpected("MATRIX COLUMNS directive", this.previous());
        }
        if (cellSource === undefined) {
          this.failExpected("MATRIX CELLS block", this.previous());
        }

        return {
          kind: "PresentationMatrixDeclaration",
          name,
          ...(density === undefined ? {} : { density }),
          rowSource,
          columnAxis,
          cellSource,
          ...(cell === undefined ? {} : { cell }),
          ...(edit === undefined ? {} : { edit }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("MATRIX DENSITY directive");
      } else if (this.checkWord("ROWS")) {
        rowSource = this.parsePresentationMatrixAxisSource();
      } else if (this.matchWord("COLUMNS")) {
        columnAxis = this.parsePresentationMatrixDateColumnAxis();
      } else if (this.checkWord("CELLS")) {
        cellSource = this.parsePresentationMatrixCellSource();
      } else if (this.checkWord("CELL")) {
        cell = this.parsePresentationMatrixCell();
      } else if (this.checkWord("EDIT")) {
        edit = this.parsePresentationMatrixEdit();
      } else if (this.checkWord("END")) {
        this.failExpected("END.MATRIX", this.current());
      } else {
        this.failUnexpected(
          "MATRIX directive DENSITY, ROWS, COLUMNS, CELLS, CELL, EDIT, or END.MATRIX",
        );
      }
    }
  }

  private parsePresentationMatrixAxisSource(): PresentationMatrixAxisSourceDeclarationAst {
    const startToken = this.expectWord("ROWS", "MATRIX ROWS block");
    this.expectWord("FROM", "ROWS FROM clause");
    const sourceKind = this.parsePresentationMatrixSourceKind("ROWS FROM clause");
    const source = this.consumeName("matrix row source");
    let keyField: string | undefined;
    let labelField: string | undefined;
    const fields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    this.consumeLineEnd("ROWS declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ROWS", this.current());
      }

      if (this.checkEnd("ROWS")) {
        const end = this.parseEnd("ROWS");

        // `labelField` is the one non-optional part of
        // `ResolvedPresentationMatrixAxisSource` beyond the source itself.
        if (labelField === undefined) {
          this.failExpected("ROWS LABEL directive", this.previous());
        }

        return {
          kind: "PresentationMatrixAxisSourceDeclaration",
          ...(sourceKind === undefined ? {} : { sourceKind }),
          source,
          ...(keyField === undefined ? {} : { keyField }),
          labelField,
          fields,
          sort,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("KEY")) {
        keyField = this.consumeName("ROWS KEY value");
        this.consumeLineEnd("ROWS KEY directive");
      } else if (this.matchWord("LABEL")) {
        labelField = this.consumeName("ROWS LABEL value");
        this.consumeLineEnd("ROWS LABEL directive");
      } else if (this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilLine("matrix row fields"));
        this.consumeLineEnd("ROWS FIELDS directive");
      } else if (this.matchWord("ORDER")) {
        this.expectWord("BY", "ROWS ORDER BY clause");
        sort.push(...this.parseSortList());
        this.consumeLineEnd("ROWS ORDER BY directive");
      } else if (this.checkWord("END")) {
        this.failExpected("END.ROWS", this.current());
      } else {
        this.failUnexpected("ROWS directive KEY, LABEL, FIELDS, ORDER BY, or END.ROWS");
      }
    }
  }

  private parsePresentationMatrixDateColumnAxis(): PresentationMatrixDateColumnAxisDeclarationAst {
    const startToken = this.previous();
    const kindToken = this.consumeWordToken("COLUMNS axis kind");

    if (normaliseKeyword(kindToken.lexeme) !== "daterange") {
      this.failExpected("COLUMNS axis kind DATE_RANGE", kindToken);
    }

    const start = String(this.consumeLiteral("COLUMNS DATE_RANGE start"));
    this.expectWord("TO", "COLUMNS DATE_RANGE TO clause");
    const end = String(this.consumeLiteral("COLUMNS DATE_RANGE end"));
    let stepDays: number | undefined;
    let labelFormat: PresentationFormatDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("STEP_DAYS")) {
        stepDays = this.consumeNumber("COLUMNS STEP_DAYS value");
      } else if (this.matchWord("LABEL_FORMAT")) {
        labelFormat = this.parsePresentationFormat();
      } else {
        this.failUnexpected("COLUMNS option STEP_DAYS, LABEL_FORMAT, or end of line");
      }
    }

    this.consumeLineEnd("MATRIX COLUMNS directive");

    return {
      kind: "PresentationMatrixDateColumnAxisDeclaration",
      columnKind: "dateRange",
      start,
      end,
      ...(stepDays === undefined ? {} : { stepDays }),
      ...(labelFormat === undefined ? {} : { labelFormat }),
      range: { start: startToken.range.start, end: this.previous().range.end },
    };
  }

  private parsePresentationMatrixCellSource(): PresentationMatrixCellSourceDeclarationAst {
    const startToken = this.expectWord("CELLS", "MATRIX CELLS block");
    this.expectWord("FROM", "CELLS FROM clause");
    const sourceKind = this.parsePresentationMatrixSourceKind("CELLS FROM clause");
    const source = this.consumeName("matrix cell source");
    this.expectWord("ROW", "CELLS ROW clause");
    const rowField = this.consumeName("CELLS ROW value");
    this.expectWord("COLUMN", "CELLS COLUMN clause");
    const columnField = this.consumeName("CELLS COLUMN value");
    const fields: string[] = [];
    const statusCandidates: PresentationStatusCandidateDeclarationAst[] = [];
    let recordSource: string | undefined;
    this.consumeLineEnd("CELLS declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.CELLS", this.current());
      }

      if (this.checkEnd("CELLS")) {
        const end = this.parseEnd("CELLS");
        return {
          kind: "PresentationMatrixCellSourceDeclaration",
          ...(sourceKind === undefined ? {} : { sourceKind }),
          source,
          rowField,
          columnField,
          fields,
          statusCandidates,
          ...(recordSource === undefined ? {} : { recordSource }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilLine("matrix cell fields"));
        this.consumeLineEnd("CELLS FIELDS directive");
      } else if (this.matchWord("RECORD_SOURCE")) {
        recordSource = this.consumeName("CELLS RECORD_SOURCE value");
        this.consumeLineEnd("CELLS RECORD_SOURCE directive");
      } else if (this.checkWord("STATUS")) {
        statusCandidates.push(this.parsePresentationStatusCandidate("CELLS"));
      } else if (this.checkWord("END")) {
        this.failExpected("END.CELLS", this.current());
      } else {
        this.failUnexpected("CELLS directive FIELDS, RECORD_SOURCE, STATUS, or END.CELLS");
      }
    }
  }

  private parsePresentationMatrixCell(): PresentationMatrixCellDeclarationAst {
    const startToken = this.expectWord("CELL", "MATRIX CELL block");
    const statusCandidates: PresentationStatusCandidateDeclarationAst[] = [];
    let unsetStatus: string | undefined;
    let accessibleLabel: string | undefined;
    this.consumeLineEnd("CELL declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.CELL", this.current());
      }

      if (this.checkEnd("CELL")) {
        const end = this.parseEnd("CELL");
        return {
          kind: "PresentationMatrixCellDeclaration",
          statusCandidates,
          ...(unsetStatus === undefined ? {} : { unsetStatus }),
          ...(accessibleLabel === undefined ? {} : { accessibleLabel }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("UNSET_STATUS")) {
        unsetStatus = this.consumeName("CELL UNSET_STATUS value");
        this.consumeLineEnd("CELL UNSET_STATUS directive");
      } else if (this.matchWord("ACCESSIBLE_LABEL")) {
        accessibleLabel = String(this.consumeLiteral("CELL ACCESSIBLE_LABEL value"));
        this.consumeLineEnd("CELL ACCESSIBLE_LABEL directive");
      } else if (this.checkWord("STATUS")) {
        statusCandidates.push(this.parsePresentationStatusCandidate("CELL"));
      } else if (this.checkWord("END")) {
        this.failExpected("END.CELL", this.current());
      } else {
        this.failUnexpected("CELL directive STATUS, UNSET_STATUS, ACCESSIBLE_LABEL, or END.CELL");
      }
    }
  }

  private parsePresentationMatrixEdit(): PresentationMatrixEditDeclarationAst {
    const startToken = this.expectWord("EDIT", "MATRIX EDIT block");
    const object = this.consumeName("matrix edit object");
    this.expectWord("ROW", "EDIT ROW clause");
    const rowField = this.consumeName("EDIT ROW value");
    this.expectWord("COLUMN", "EDIT COLUMN clause");
    const columnField = this.consumeName("EDIT COLUMN value");
    this.expectWord("VALUE", "EDIT VALUE clause");
    const valueField = this.consumeName("EDIT VALUE value");
    const cycle: JsonPrimitive[] = [];
    // `undefined` means the directive was absent; `null` means `UNSET_VALUE
    // null` was written. `resolvePresentationMatrixEdit` keeps the two apart,
    // so the parser must too.
    let unsetValue: JsonPrimitive | undefined;
    let unsetAsAbsence: boolean | undefined;
    let bulkBehavior: PresentationMatrixBulkBehavior | undefined;
    this.consumeLineEnd("EDIT declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.EDIT", this.current());
      }

      if (this.checkEnd("EDIT")) {
        const end = this.parseEnd("EDIT");
        return {
          kind: "PresentationMatrixEditDeclaration",
          object,
          rowField,
          columnField,
          valueField,
          cycle,
          ...(unsetValue === undefined ? {} : { unsetValue }),
          ...(unsetAsAbsence === undefined ? {} : { unsetAsAbsence }),
          ...(bulkBehavior === undefined ? {} : { bulkBehavior }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("CYCLE")) {
        while (!this.isLineEnd()) {
          this.skipComma();
          if (this.isLineEnd()) {
            break;
          }
          cycle.push(this.consumePrimitiveLiteral("EDIT CYCLE value"));
          this.skipComma();
        }
        this.consumeLineEnd("EDIT CYCLE directive");
      } else if (this.matchWord("UNSET_VALUE")) {
        unsetValue = this.consumePrimitiveLiteral("EDIT UNSET_VALUE value");
        this.consumeLineEnd("EDIT UNSET_VALUE directive");
      } else if (this.matchWord("UNSET_AS_ABSENCE")) {
        unsetAsAbsence = this.parseOptionalBoolean();
        this.consumeLineEnd("EDIT UNSET_AS_ABSENCE directive");
      } else if (this.matchWord("BULK_BEHAVIOR")) {
        const behaviorToken = this.consumeWordToken("EDIT BULK_BEHAVIOR value");
        if (normaliseKeyword(behaviorToken.lexeme) !== "sequentialvalidatedwrites") {
          this.failExpected("EDIT BULK_BEHAVIOR SEQUENTIAL_VALIDATED_WRITES", behaviorToken);
        }
        bulkBehavior = "sequentialValidatedWrites";
        this.consumeLineEnd("EDIT BULK_BEHAVIOR directive");
      } else if (this.checkWord("END")) {
        this.failExpected("END.EDIT", this.current());
      } else {
        this.failUnexpected(
          "EDIT directive CYCLE, UNSET_VALUE, UNSET_AS_ABSENCE, BULK_BEHAVIOR, or END.EDIT",
        );
      }
    }
  }

  /**
   * `OBJECT X` / `READ_MODEL X` after a `FROM`, mirroring `LIST`'s and
   * `CALENDAR`'s own headers. A bare `FROM X` leaves `sourceKind` undefined and
   * resolves to `readModel`, which is what the model's own default already
   * says — so the two spellings are not the same fact written twice.
   */
  private parsePresentationMatrixSourceKind(
    context: string,
  ): PresentationMatrixSourceKind | undefined {
    if (this.matchWord("OBJECT")) {
      return "object";
    }
    if (this.matchUnderscoreOrDottedWord(context, "READ_MODEL", "READ", "MODEL")) {
      return "readModel";
    }
    return undefined;
  }

  /**
   * `STATUS <status>`, `STATUS <map>(FIELD <field>)`, `STATUS <map>(VALUE <literal>)`
   * or `STATUS <map>()`.
   *
   * The empty-parenthesis form is a *map* candidate carrying neither a field
   * nor a value, which means "use the status map's own declared field" — a
   * shape `PartialPresentationStatusCandidateModel` has always allowed and the
   * validator explicitly handles, but which had no text spelling before
   * Phase 104 and therefore no way back out of the printer. Dropping the
   * parentheses is not available as a spelling: a bare name is a *direct*
   * status reference, and the two resolve to different models.
   *
   * `context` names the enclosing directive in the failure messages only.
   * `LIST` is the default because `LIST` and `CALENDAR` have both reported it
   * that way since Phase 25; changing what they say is not this method's job.
   */
  private parsePresentationStatusCandidate(
    context = "LIST",
  ): PresentationStatusCandidateDeclarationAst {
    const startToken = this.expectWord("STATUS", `${context} STATUS directive`);
    const name = this.consumeName("presentation status name or map");

    if (!this.matchSymbol("(")) {
      this.consumeLineEnd(`${context} STATUS directive`);
      return {
        kind: "direct",
        status: name,
        range: this.rangeFrom(startToken),
      };
    }

    if (this.matchSymbol(")")) {
      this.consumeLineEnd(`${context} STATUS directive`);
      return {
        kind: "map",
        map: name,
        range: this.rangeFrom(startToken),
      };
    }

    if (this.matchWord("FIELD")) {
      const field = this.consumeName("presentation status map field");
      this.expectSymbol(")", "presentation status map reference");
      this.consumeLineEnd(`${context} STATUS directive`);
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
      this.consumeLineEnd(`${context} STATUS directive`);
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
      this.consumeLineEnd(`${context} STATUS directive`);
      return {
        kind: "map",
        map: name,
        field,
        range: this.rangeFrom(startToken),
      };
    }

    const value = this.consumePrimitiveLiteral("presentation status map value");
    this.expectSymbol(")", "presentation status map reference");
    this.consumeLineEnd(`${context} STATUS directive`);
    return {
      kind: "map",
      map: name,
      value,
      range: this.rangeFrom(startToken),
    };
  }
}
