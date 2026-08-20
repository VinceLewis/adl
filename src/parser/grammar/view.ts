import type {
  EditChildOperationKind,
  EditContainerMode,
  PresentationDensity,
  PresentationLayout,
  RelationshipPickerSelectionMode,
  RelationshipPickerSourceKind,
  ViewKind,
} from "../../model/resolved-model.js";
import type {
  EditChildCollectionDeclarationAst,
  EditFieldsSectionDeclarationAst,
  EditSectionDeclarationAst,
  RelationshipPickerDeclarationAst,
  PresentationIconMapDeclarationAst,
  PresentationLegendDeclarationAst,
  PresentationSectionDeclarationAst,
  PresentationStatusDeclarationAst,
  PresentationStatusMapDeclarationAst,
  PresentationStateDeclarationAst,
  SortDeclarationAst,
  ViewDeclarationAst,
  ViewContextDeclarationAst,
} from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { PresentationCoreParser } from "./presentation-core.js";

/**
 * `VIEW` declarations and their edit surfaces.
 */
export class ViewParser extends PresentationCoreParser {
  protected parseView(): ViewDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("VIEW", "VIEW declaration");
    const name = this.consumeName("view name");
    const viewKind = this.parseViewKind();
    let context: ViewContextDeclarationAst | undefined;
    let readModel: string | undefined;
    let editContainer: EditContainerMode | undefined;
    const fields: string[] = [];
    const searchFields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    const actions: string[] = [];
    const editSections: EditSectionDeclarationAst[] = [];
    let layout: PresentationLayout | undefined;
    let density: PresentationDensity | undefined;
    const state: PresentationStateDeclarationAst[] = [];
    const iconMaps: PresentationIconMapDeclarationAst[] = [];
    const statuses: PresentationStatusDeclarationAst[] = [];
    const statusMaps: PresentationStatusMapDeclarationAst[] = [];
    const legends: PresentationLegendDeclarationAst[] = [];
    const sections: PresentationSectionDeclarationAst[] = [];
    this.consumeLineEnd("VIEW declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.VIEW", this.current());
      }

      if (this.checkEnd("VIEW")) {
        const end = this.parseEnd("VIEW");
        return {
          kind: "ViewDeclaration",
          name,
          viewKind,
          ...(context === undefined ? {} : { context }),
          ...(readModel === undefined ? {} : { readModel }),
          ...(editContainer === undefined ? {} : { editContainer }),
          fields,
          searchFields,
          sort,
          actions,
          editSections,
          ...(layout === undefined &&
          density === undefined &&
          state.length === 0 &&
          iconMaps.length === 0 &&
          statuses.length === 0 &&
          statusMaps.length === 0 &&
          legends.length === 0 &&
          sections.length === 0
            ? {}
            : {
                presentation: {
                  kind: "ViewPresentationDeclaration",
                  ...(layout === undefined ? {} : { layout }),
                  ...(density === undefined ? {} : { density }),
                  state,
                  iconMaps,
                  statuses,
                  statusMaps,
                  legends,
                  sections,
                  range: { start: startToken.range.start, end: end.range.end },
                },
              }),
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("CONTEXT")) {
        context = this.parseViewContextAfterKeyword();
        this.consumeLineEnd("VIEW CONTEXT directive");
      } else if (
        this.matchUnderscoreOrDottedWord("VIEW READ_MODEL", "READ_MODEL", "READ", "MODEL")
      ) {
        readModel = this.consumeName("view read model name");
        this.consumeLineEnd("VIEW READ_MODEL directive");
      } else if (this.matchWord("EDIT_CONTAINER")) {
        editContainer = this.parseEditContainerMode();
        this.consumeLineEnd("VIEW EDIT_CONTAINER directive");
      } else if (this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilLine("view field list"));
        this.consumeLineEnd("VIEW FIELDS directive");
      } else if (this.matchWord("SEARCH")) {
        searchFields.push(...this.consumeNameListUntilLine("view search field list"));
        this.consumeLineEnd("VIEW SEARCH directive");
      } else if (this.matchWord("ACTIONS")) {
        actions.push(...this.consumeNameListUntilLine("view action list"));
        this.consumeLineEnd("VIEW ACTIONS directive");
      } else if (this.matchWord("SORT")) {
        sort.push(...this.parseSortList());
        this.consumeLineEnd("VIEW SORT directive");
      } else if (this.matchWord("LAYOUT")) {
        layout = this.parsePresentationLayout();
        this.consumeLineEnd("VIEW LAYOUT directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("VIEW DENSITY directive");
      } else if (this.checkWord("STATE")) {
        state.push(this.parsePresentationState());
      } else if (this.checkWord("ICON_MAP") || this.checkDottedWord("ICON", "MAP")) {
        iconMaps.push(this.parsePresentationIconMap());
      } else if (this.checkWord("STATUS_MAP") || this.checkDottedWord("STATUS", "MAP")) {
        statusMaps.push(this.parsePresentationStatusMap());
      } else if (this.checkWord("STATUS")) {
        statuses.push(this.parsePresentationStatus());
      } else if (this.checkWord("LEGEND")) {
        legends.push(this.parsePresentationLegend());
      } else if (this.checkWord("SECTION")) {
        sections.push(this.parsePresentationSection());
      } else if (this.checkWord("EDIT_SECTION")) {
        editSections.push(this.parseEditFieldsSection());
      } else if (this.checkWord("CHILD_COLLECTION")) {
        editSections.push(this.parseEditChildCollection());
      } else {
        this.failUnexpected(
          "VIEW directive CONTEXT, READ_MODEL, EDIT_CONTAINER, FIELDS, SEARCH, ACTIONS, SORT, LAYOUT, DENSITY, STATE, ICON_MAP, STATUS, STATUS_MAP, LEGEND, SECTION, EDIT_SECTION, CHILD_COLLECTION, or END.VIEW",
        );
      }
    }
  }

  /**
   * A parent field group on an edit surface.
   *
   * It is `EDIT_SECTION` rather than `SECTION` because a view's `SECTION` already
   * means a composed presentation section, and a view may declare both. Two
   * different things could not share one keyword without one of them changing
   * meaning by position.
   */
  private parseEditFieldsSection(): EditFieldsSectionDeclarationAst {
    const startToken = this.expectWord("EDIT_SECTION", "EDIT_SECTION declaration");
    const name = this.consumeName("edit section name");
    let heading: string | undefined;
    let fields: string[] | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("edit section heading"));
      } else {
        this.failUnexpected("EDIT_SECTION header option HEADING or end of line");
      }
    }
    this.consumeLineEnd("EDIT_SECTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.EDIT_SECTION", this.current());
      }

      if (this.checkEnd("EDIT_SECTION")) {
        const end = this.parseEnd("EDIT_SECTION");
        return {
          kind: "EditFieldsSectionDeclaration",
          name,
          ...(heading === undefined ? {} : { heading }),
          ...(fields === undefined ? {} : { fields }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("edit section heading"));
        this.consumeLineEnd("EDIT_SECTION HEADING directive");
      } else if (this.matchWord("FIELDS")) {
        fields = [...(fields ?? []), ...this.consumeNameListUntilLine("edit section field list")];
        this.consumeLineEnd("EDIT_SECTION FIELDS directive");
      } else {
        this.failUnexpected("EDIT_SECTION directive HEADING, FIELDS, or END.EDIT_SECTION");
      }
    }
  }

  /**
   * A child collection edited inside its parent's form.
   *
   * `CHILD` and `PARENT_FIELD` are both required, and deliberately so: the child
   * object alone does not say which of its lookups points back at this parent,
   * and inferring one would silently pick a field when an object has two.
   */
  private parseEditChildCollection(): EditChildCollectionDeclarationAst {
    const startToken = this.expectWord("CHILD_COLLECTION", "CHILD_COLLECTION declaration");
    const name = this.consumeName("child collection name");
    let heading: string | undefined;
    let childObject: string | undefined;
    let parentField: string | undefined;
    let childView: string | undefined;
    let operations: EditChildOperationKind[] | undefined;
    let staged: boolean | undefined;
    let orderField: string | undefined;
    let emptyText: string | undefined;
    let picker: RelationshipPickerDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("child collection heading"));
      } else {
        this.failUnexpected("CHILD_COLLECTION header option HEADING or end of line");
      }
    }
    this.consumeLineEnd("CHILD_COLLECTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.CHILD_COLLECTION", this.current());
      }

      if (this.checkEnd("CHILD_COLLECTION")) {
        const end = this.parseEnd("CHILD_COLLECTION");
        if (childObject === undefined || parentField === undefined) {
          this.failExpected("CHILD_COLLECTION CHILD directive with PARENT_FIELD", this.previous());
        }
        return {
          kind: "EditChildCollectionDeclaration",
          name,
          ...(heading === undefined ? {} : { heading }),
          childObject,
          parentField,
          ...(childView === undefined ? {} : { childView }),
          ...(operations === undefined ? {} : { operations }),
          ...(staged === undefined ? {} : { staged }),
          ...(orderField === undefined ? {} : { orderField }),
          ...(emptyText === undefined ? {} : { emptyText }),
          ...(picker === undefined ? {} : { picker }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("child collection heading"));
        this.consumeLineEnd("CHILD_COLLECTION HEADING directive");
      } else if (this.matchWord("CHILD")) {
        childObject = this.consumeName("child collection child object name");
        this.expectWord("PARENT_FIELD", "CHILD_COLLECTION CHILD directive");
        parentField = this.consumeName("child collection parent field name");
        this.consumeLineEnd("CHILD_COLLECTION CHILD directive");
      } else if (this.matchWord("CHILD_VIEW")) {
        childView = this.consumeName("child collection child view name");
        this.consumeLineEnd("CHILD_COLLECTION CHILD_VIEW directive");
      } else if (this.matchWord("OPERATIONS")) {
        operations = this.parseEditChildOperations();
        this.consumeLineEnd("CHILD_COLLECTION OPERATIONS directive");
      } else if (this.matchWord("STAGED")) {
        staged = this.parseOptionalBoolean();
        this.consumeLineEnd("CHILD_COLLECTION STAGED directive");
      } else if (this.matchWord("ORDER_FIELD")) {
        orderField = this.consumeName("child collection order field name");
        this.consumeLineEnd("CHILD_COLLECTION ORDER_FIELD directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("child collection empty text"));
        this.consumeLineEnd("CHILD_COLLECTION EMPTY_TEXT directive");
      } else if (this.checkWord("PICKER")) {
        picker = this.parseRelationshipPicker();
      } else {
        this.failUnexpected(
          "CHILD_COLLECTION directive HEADING, CHILD, CHILD_VIEW, OPERATIONS, STAGED, ORDER_FIELD, EMPTY_TEXT, PICKER, or END.CHILD_COLLECTION",
        );
      }
    }
  }

  private parseRelationshipPicker(): RelationshipPickerDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("PICKER", "PICKER declaration");
    const name = this.consumeName("relationship picker name");
    let sourceKind: RelationshipPickerSourceKind | undefined;
    let source: string | undefined;
    let candidateField: string | undefined;
    let selection: RelationshipPickerSelectionMode | undefined;
    const displayFields: string[] = [];
    const searchFields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    let excludeAlreadyLinked: boolean | undefined;
    let emptyText: string | undefined;
    this.consumeLineEnd("PICKER declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.PICKER", this.current());
      }

      if (this.checkEnd("PICKER")) {
        const end = this.parseEnd("PICKER");
        return {
          kind: "RelationshipPickerDeclaration",
          name,
          ...(sourceKind === undefined ? {} : { sourceKind }),
          ...(source === undefined ? {} : { source }),
          ...(candidateField === undefined ? {} : { candidateField }),
          ...(selection === undefined ? {} : { selection }),
          displayFields,
          searchFields,
          sort,
          ...(excludeAlreadyLinked === undefined ? {} : { excludeAlreadyLinked }),
          ...(emptyText === undefined ? {} : { emptyText }),
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("SOURCE")) {
        sourceKind = this.parseRelationshipPickerSourceKind();
        source = this.consumeName("relationship picker source name");
        this.consumeLineEnd("PICKER SOURCE directive");
      } else if (this.matchWord("CANDIDATE_FIELD")) {
        candidateField = this.consumeName("relationship picker candidate field name");
        this.consumeLineEnd("PICKER CANDIDATE_FIELD directive");
      } else if (this.matchWord("SELECTION")) {
        selection = this.parseRelationshipPickerSelection();
        this.consumeLineEnd("PICKER SELECTION directive");
      } else if (this.matchWord("DISPLAY")) {
        displayFields.push(...this.consumeNameListUntilLine("relationship picker display fields"));
        this.consumeLineEnd("PICKER DISPLAY directive");
      } else if (this.matchWord("SEARCH")) {
        searchFields.push(...this.consumeNameListUntilLine("relationship picker search fields"));
        this.consumeLineEnd("PICKER SEARCH directive");
      } else if (this.matchWord("SORT")) {
        sort.push(...this.parseSortList());
        this.consumeLineEnd("PICKER SORT directive");
      } else if (this.matchWord("EXCLUDE_LINKED")) {
        excludeAlreadyLinked = this.parseOptionalBoolean();
        this.consumeLineEnd("PICKER EXCLUDE_LINKED directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("relationship picker empty text"));
        this.consumeLineEnd("PICKER EMPTY_TEXT directive");
      } else {
        this.failUnexpected(
          "PICKER directive SOURCE, CANDIDATE_FIELD, SELECTION, DISPLAY, SEARCH, SORT, EXCLUDE_LINKED, EMPTY_TEXT, or END.PICKER",
        );
      }
    }
  }

  /**
   * Each operation is checked at the token it was read from, rather than by
   * mapping over a fully consumed list. Reading the whole line first would
   * report the *last* operation as the unexpected one, which is usually a
   * perfectly valid word and sends the author to the wrong place on the line.
   */
  private parseEditChildOperations(): EditChildOperationKind[] {
    const operations: EditChildOperationKind[] = [];

    while (!this.isLineEnd()) {
      this.skipComma();

      if (this.isLineEnd()) {
        break;
      }

      const token = this.current();
      const operation = this.consumeName("child collection operation list");

      switch (normaliseKeyword(operation)) {
        case "createchild":
          operations.push("createChild");
          break;
        case "linkexisting":
          operations.push("linkExisting");
          break;
        case "updatechild":
          operations.push("updateChild");
          break;
        case "unlink":
          operations.push("unlink");
          break;
        case "remove":
          operations.push("remove");
          break;
        case "reorder":
          operations.push("reorder");
          break;
        default:
          this.failExpected(
            "child collection operation createChild, linkExisting, updateChild, unlink, remove, or reorder",
            token,
          );
      }

      this.skipComma();
    }

    if (operations.length === 0) {
      this.failExpected("child collection operation list", this.current());
    }

    return operations;
  }

  private parseEditContainerMode(): EditContainerMode {
    const token = this.consumeWordToken("edit container mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "modal":
        return "modal";
      case "drawer":
        return "drawer";
      case "page":
        return "page";
      case "splitpane":
        return "splitPane";
      default:
        this.failExpected("edit container mode MODAL, DRAWER, PAGE, or SPLITPANE", token);
    }
  }

  private parseRelationshipPickerSourceKind(): RelationshipPickerSourceKind {
    const token = this.consumeWordToken("relationship picker source kind");

    switch (normaliseKeyword(token.lexeme)) {
      case "object":
        return "object";
      case "read_model":
      case "readmodel":
        return "readModel";
      default:
        this.failExpected("relationship picker source kind OBJECT or READ_MODEL", token);
    }
  }

  private parseRelationshipPickerSelection(): RelationshipPickerSelectionMode {
    const token = this.consumeWordToken("relationship picker selection mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "single":
        return "single";
      case "multiple":
        return "multiple";
      default:
        this.failExpected("relationship picker selection mode SINGLE or MULTIPLE", token);
    }
  }

  private parseViewKind(): ViewKind {
    const token = this.consumeWordToken("view kind");

    switch (normaliseKeyword(token.lexeme)) {
      case "list":
        return "list";
      case "detail":
        return "detail";
      case "form":
        return "form";
      case "dashboard":
        return "dashboard";
      case "masterdetail":
        return "masterDetail";
      case "grid":
        return "grid";
      case "composite":
        return "composite";
      default:
        this.failExpected(
          "view kind LIST, DETAIL, FORM, DASHBOARD, MASTER_DETAIL, GRID, or COMPOSITE",
          token,
        );
    }
  }
}
