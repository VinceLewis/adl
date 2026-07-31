import type {
  ConflictStrategy,
  EditChildOperationKind,
  EditContainerMode,
  FieldType,
  JsonValue,
  JsonPrimitive,
  CommandRuntimeProperty,
  CommandStepAuthority,
  CommandStepMetaProperty,
  ContextSelectionMode,
  ContextSelectionPersistence,
  ContextSelectionSource,
  PresentationDensity,
  PresentationFormatKind,
  PresentationFragmentStyle,
  PresentationLegendInclude,
  PresentationLayout,
  PresentationActionPlacement,
  PresentationCalendarSourceKind,
  PresentationCalendarWeekStart,
  PresentationListRenderStyle,
  PresentationListSourceKind,
  PresentationRowLayout,
  PresentationStatusThemeToken,
  PresentationStatePersistence,
  PresentationStateType,
  OrderedCollectionCompaction,
  OrderedCollectionReorder,
  PolicyAction,
  PolicyEffect,
  ExpressionRuntimeProperty,
  ReadModelJoinCardinality,
  RelationshipPickerSelectionMode,
  RelationshipPickerSourceKind,
  ResolvedCommandValueExpression,
  ResolvedExpression,
  RuntimeChannel,
  ShellContextSelectorPlacement,
  ShellControlKind,
  ShellControlPlacement,
  ShellMobileContextSelectorMode,
  ShellVisibilityKind,
  SyncMode,
  SyncScope,
  ThemeDensity,
  ThemeNav,
  ThemeRadius,
  ValidatorKind,
  ViewKind,
  ViewContextMode,
} from "../model/resolved-model.js";
import type {
  ActionAllowDeclarationAst,
  ActionDeclarationAst,
  AdlDocumentAst,
  AppDeclarationAst,
  AutoIdDeclarationAst,
  BlockName,
  BusinessContextDeclarationAst,
  CommandDeclarationAst,
  CommandInputDeclarationAst,
  CommandInputItemFieldDeclarationAst,
  CommandPreconditionDeclarationAst,
  CommandStepDeclarationAst,
  ComputedFieldDeclarationAst,
  ContextGrantDeclarationAst,
  DecisionTableDeclarationAst,
  DecisionTableInputDeclarationAst,
  DecisionTableRowDeclarationAst,
  EditChildCollectionDeclarationAst,
  EditFieldsSectionDeclarationAst,
  EditSectionDeclarationAst,
  EndMarkerNode,
  FieldDeclarationAst,
  HookRefsAst,
  LifecycleGuardDeclarationAst,
  LifecycleDeclarationAst,
  LookupDeclarationAst,
  ObjectConstraintDeclarationAst,
  ObjectValidationDeclarationAst,
  ObjectDeclarationAst,
  ObjectScopeDeclarationAst,
  PolicyDeclarationAst,
  PolicyRuleDeclarationAst,
  RelationshipPickerDeclarationAst,
  PresentationActionControlDeclarationAst,
  PresentationActionInputDeclarationAst,
  PresentationControlDeclarationAst,
  PresentationIconMapDeclarationAst,
  PresentationIconMapValueDeclarationAst,
  PresentationIconRefDeclarationAst,
  PresentationLegendDeclarationAst,
  PresentationCalendarDeclarationAst,
  PresentationListDeclarationAst,
  PresentationRowFragmentDeclarationAst,
  PresentationRowTemplateDeclarationAst,
  PresentationSectionDeclarationAst,
  PresentationStatusCandidateDeclarationAst,
  PresentationStatusDeclarationAst,
  PresentationStatusMapDeclarationAst,
  PresentationStatusMapValueDeclarationAst,
  PresentationStateDeclarationAst,
  PresentationToggleControlDeclarationAst,
  PrincipalSelectorAst,
  ReadModelDeclarationAst,
  ReadModelFieldDeclarationAst,
  ReadModelSourceDeclarationAst,
  ReadModelSourceJoinDeclarationAst,
  RoleDeclarationAst,
  ShellControlDeclarationAst,
  ShellDeclarationAst,
  ShellNavDrawerDeclarationAst,
  ShellNavItemDeclarationAst,
  ShellTopBarDeclarationAst,
  ShellVisibilityDeclarationAst,
  SortDeclarationAst,
  SourcePosition,
  SourceRange,
  StateDeclarationAst,
  SyncDeclarationAst,
  MigrationDeclarationAst,
  MigrationObjectDeclarationAst,
  MigrationStepAst,
  ThemeDeclarationAst,
  ThemeTokenDeclarationAst,
  ThemeTokenName,
  ValidatorDeclarationAst,
  ViewDeclarationAst,
  ViewContextDeclarationAst,
} from "./ast.js";
import { lexAdl } from "./lexer.js";
import type { Token } from "./lexer.js";

export interface ParserDiagnostic {
  severity: "error";
  code:
    | "ADL_PARSE_EXPECTED_TOKEN"
    | "ADL_PARSE_UNEXPECTED_TOKEN"
    | "ADL_PARSE_UNSUPPORTED_PROCEDURAL_KEYWORD";
  message: string;
  sourceRange: SourceRange;
}

export class ParseError extends Error {
  readonly diagnostic: ParserDiagnostic;

  constructor(diagnostic: ParserDiagnostic) {
    super(
      `${diagnostic.message} at ${diagnostic.sourceRange.start.line}:${diagnostic.sourceRange.start.column}`,
    );
    this.name = "ParseError";
    this.diagnostic = diagnostic;
  }
}

export function parseAdl(source: string): AdlDocumentAst {
  return new AdlParser(lexAdl(source)).parseDocument();
}

const PROCEDURAL_KEYWORDS = new Set([
  "FETCH",
  "STORE",
  "LOOP",
  "SET",
  "REPEAT",
  "CHECK",
  "DART.INLINE",
  "SQL.INTO",
]);

const FIELD_LIST_STOP_WORDS = new Set([
  "ROLE",
  "ROLES",
  "GROUP_ROLE",
  "GROUP_ROLES",
  "USER",
  "USERS",
  "OWNER",
  "EVERYONE",
  "AUTHENTICATED",
  "ANONYMOUS",
  "CONTEXT_MEMBER",
  "STATE",
  "ACTION",
  "CHANNEL",
  "CHANNELS",
  "WHEN",
]);

/**
 * Words that end the `SOURCE <name> [<object>]` shorthand. Without these an
 * option keyword immediately after the source name would be read as the object.
 */
const READ_MODEL_SOURCE_OPTION_WORDS = new Set(["SCOPE", "AS", "JOIN", "CARDINALITY"]);

/** Modifiers that may follow `INPUT <name> LIST` in place of an item type. */
const COMMAND_INPUT_MODIFIER_WORDS = new Set(["REQUIRED", "OPTIONAL", "DEFAULT"]);

/**
 * Step-header keywords that may follow a value expression, so a bare `ITEM`
 * there is not mistaken for `ITEM <field>`.
 */
const COMMAND_STEP_HEADER_WORDS = new Set([
  "AUTHORITY",
  "ID",
  "RECORD",
  "FOR",
  "FOR_EACH",
  "ESTABLISHES",
]);

class AdlParser {
  private currentIndex = 0;
  /**
   * The `ON <Context>` token of every parsed `CONTEXT_GRANT`, kept so the
   * end-of-document check can point at the name rather than the whole line.
   */
  private readonly contextGrantTargets: { context: string; token: Token }[] = [];

  constructor(private readonly tokens: Token[]) {}

  parseDocument(): AdlDocumentAst {
    this.skipNewlines();
    const start = this.current().range.start;
    const app = this.parseApp();
    let shell: ShellDeclarationAst | undefined;
    const roles: RoleDeclarationAst[] = [];
    const contexts: BusinessContextDeclarationAst[] = [];
    const contextGrants: ContextGrantDeclarationAst[] = [];
    const objects: ObjectDeclarationAst[] = [];
    const readModels: ReadModelDeclarationAst[] = [];
    const decisionTables: DecisionTableDeclarationAst[] = [];
    const commands: CommandDeclarationAst[] = [];
    const policies: PolicyDeclarationAst[] = [];
    const themes: ThemeDeclarationAst[] = [];
    const sync: SyncDeclarationAst[] = [];
    const migrations: MigrationDeclarationAst[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        break;
      }

      if (this.checkWord("SHELL")) {
        shell = this.parseShell();
      } else if (this.checkWord("ROLE")) {
        roles.push(this.parseRole());
      } else if (this.checkWord("CONTEXT_GRANT") || this.checkDottedWord("CONTEXT", "GRANT")) {
        contextGrants.push(this.parseContextGrant());
      } else if (this.checkWord("CONTEXT")) {
        contexts.push(this.parseBusinessContext());
      } else if (this.checkWord("OBJECT")) {
        objects.push(this.parseObject());
      } else if (this.checkWord("READ_MODEL") || this.checkDottedWord("READ", "MODEL")) {
        readModels.push(this.parseReadModel());
      } else if (this.checkWord("DECISION_TABLE") || this.checkDottedWord("DECISION", "TABLE")) {
        decisionTables.push(this.parseDecisionTable());
      } else if (this.checkWord("COMMAND")) {
        commands.push(this.parseCommand());
      } else if (this.checkWord("POLICY")) {
        policies.push(this.parsePolicy());
      } else if (this.checkWord("THEME")) {
        themes.push(this.parseTheme());
      } else if (this.checkWord("SYNC")) {
        sync.push(this.parseSync(false));
      } else if (this.checkWord("MIGRATION")) {
        migrations.push(this.parseMigration());
      } else {
        // `APP` is deliberately absent: it is consumed before this loop starts,
        // and a second one is not a top-level declaration this grammar accepts.
        this.failUnexpected(
          "a top-level SHELL, ROLE, CONTEXT, CONTEXT_GRANT, OBJECT, READ_MODEL, DECISION_TABLE, COMMAND, POLICY, THEME, SYNC, MIGRATION, or end of file",
        );
      }
    }

    this.requireDeclaredContextsForGrants(contexts, contextGrants);

    return {
      kind: "AdlDocument",
      app,
      ...(shell === undefined ? {} : { shell }),
      roles,
      contexts,
      contextGrants,
      objects,
      readModels,
      decisionTables,
      commands,
      policies,
      themes,
      sync,
      migrations,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseApp(): AppDeclarationAst {
    const startToken = this.expectWord("APP", "APP declaration");
    const name = this.consumeName("application name");
    let theme: string | undefined;
    let startView: string | undefined;
    let offlineGraceDays: number | undefined;
    let modelVersion: string | undefined;
    this.consumeLineEnd("APP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.APP", this.current());
      }

      if (this.checkEnd("APP")) {
        const end = this.parseEnd("APP");
        return {
          kind: "AppDeclaration",
          name,
          ...(theme === undefined ? {} : { theme }),
          ...(startView === undefined ? {} : { startView }),
          ...(offlineGraceDays === undefined ? {} : { offlineGraceDays }),
          ...(modelVersion === undefined ? {} : { modelVersion }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("THEME")) {
        theme = this.consumeName("application theme name");
        this.consumeLineEnd("APP THEME directive");
      } else if (this.matchWord("START_VIEW")) {
        startView = this.consumeName("application start view name");
        this.consumeLineEnd("APP START_VIEW directive");
      } else if (this.matchWord("OFFLINE_GRACE")) {
        // The unit word is required, so a bare number can never be read as the
        // wrong unit if a second unit is ever added.
        offlineGraceDays = this.consumeNumber("APP OFFLINE_GRACE day count");
        this.expectWord("DAYS", "APP OFFLINE_GRACE unit");
        this.consumeLineEnd("APP OFFLINE_GRACE directive");
      } else if (this.matchWord("MODEL_VERSION") || this.matchDottedWord("MODEL", "VERSION")) {
        // Quoted, and read as text rather than a number, so `1.1.0` survives:
        // a bare dotted literal is not a number the lexer can carry intact.
        modelVersion = this.consumeName("APP MODEL_VERSION value");
        this.consumeLineEnd("APP MODEL_VERSION directive");
      } else {
        this.failUnexpected(
          "APP directive THEME, START_VIEW, OFFLINE_GRACE, MODEL_VERSION, or END.APP",
        );
      }
    }
  }

  /**
   * ```text
   * MIGRATION FROM "1.0.0" TO "1.1.0"
   *   OBJECT Gig
   *     SCHEMA_VERSION 2
   *     RENAME FIELD Venue TO VenueName
   *     ADD FIELD PayoutCents DEFAULT 0
   *     DROP FIELD LegacyNote
   *   END.OBJECT
   * END.MIGRATION
   * ```
   *
   * A migration declares how persisted records reach this model from an earlier
   * one. It never mentions storage engines, tables or SQL: the projection's own
   * tables migrate out of band through ordered SQL files, and this block is only
   * about the shape of a record.
   */
  private parseMigration(): MigrationDeclarationAst {
    const startToken = this.expectWord("MIGRATION", "MIGRATION declaration");
    this.expectWord("FROM", "MIGRATION FROM version");
    const from = this.consumeName("MIGRATION FROM version");
    this.expectWord("TO", "MIGRATION TO version");
    const to = this.consumeName("MIGRATION TO version");
    this.consumeLineEnd("MIGRATION declaration");
    const objects: MigrationObjectDeclarationAst[] = [];

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.MIGRATION", this.current());
      }

      if (this.checkEnd("MIGRATION")) {
        const end = this.parseEnd("MIGRATION");
        return {
          kind: "MigrationDeclaration",
          from,
          to,
          objects,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("OBJECT")) {
        objects.push(this.parseMigrationObject());
      } else {
        this.failUnexpected("MIGRATION directive OBJECT or END.MIGRATION");
      }
    }
  }

  private parseMigrationObject(): MigrationObjectDeclarationAst {
    const startToken = this.expectWord("OBJECT", "MIGRATION OBJECT declaration");
    const object = this.consumeName("MIGRATION OBJECT name");
    this.consumeLineEnd("MIGRATION OBJECT declaration");
    const steps: MigrationStepAst[] = [];
    let schemaVersion: number | undefined;

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.OBJECT", this.current());
      }

      if (this.checkEnd("OBJECT")) {
        const end = this.parseEnd("OBJECT");
        return {
          kind: "MigrationObjectDeclaration",
          object,
          ...(schemaVersion === undefined ? {} : { schemaVersion }),
          steps,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      const stepToken = this.current();

      if (this.matchWord("SCHEMA_VERSION") || this.matchDottedWord("SCHEMA", "VERSION")) {
        schemaVersion = this.consumeNumber("MIGRATION OBJECT SCHEMA_VERSION value");
        this.consumeLineEnd("MIGRATION OBJECT SCHEMA_VERSION directive");
      } else if (this.matchWord("RENAME")) {
        this.expectWord("FIELD", "MIGRATION RENAME FIELD directive");
        const from = this.consumeName("MIGRATION RENAME source field");
        this.expectWord("TO", "MIGRATION RENAME target field");
        const to = this.consumeName("MIGRATION RENAME target field");
        this.consumeLineEnd("MIGRATION RENAME FIELD directive");
        steps.push({
          kind: "renameField",
          from,
          to,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else if (this.matchWord("ADD")) {
        this.expectWord("FIELD", "MIGRATION ADD FIELD directive");
        const field = this.consumeName("MIGRATION ADD FIELD name");
        // Required, not optional: a record that silently gains `null` where the
        // model says the field is required would fail validation on next write.
        this.expectWord("DEFAULT", "MIGRATION ADD FIELD DEFAULT value");
        const defaultValue = this.consumeModifierValue("MIGRATION ADD FIELD DEFAULT value");
        this.consumeLineEnd("MIGRATION ADD FIELD directive");
        steps.push({
          kind: "addField",
          field,
          defaultValue,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else if (this.matchWord("DROP")) {
        this.expectWord("FIELD", "MIGRATION DROP FIELD directive");
        const field = this.consumeName("MIGRATION DROP FIELD name");
        this.consumeLineEnd("MIGRATION DROP FIELD directive");
        steps.push({
          kind: "dropField",
          field,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else {
        this.failUnexpected(
          "MIGRATION OBJECT directive SCHEMA_VERSION, RENAME FIELD, ADD FIELD, DROP FIELD, or END.OBJECT",
        );
      }
    }
  }

  private parseRole(): RoleDeclarationAst {
    const startToken = this.expectWord("ROLE", "ROLE declaration");
    const name = this.consumeName("role name");
    let inherits: string[] = [];
    let description: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("INHERITS")) {
        inherits = this.consumeNameListUntilLine("role inheritance list");
      } else if (this.matchWord("DESCRIPTION")) {
        description = this.consumeName("role description");
      } else {
        this.failUnexpected("ROLE directive INHERITS, DESCRIPTION, or end of line");
      }
    }

    this.consumeLineEnd("ROLE declaration");
    return {
      kind: "RoleDeclaration",
      name,
      inherits,
      ...(description === undefined ? {} : { description }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShell(): ShellDeclarationAst {
    const startToken = this.expectWord("SHELL", "SHELL declaration");
    const navItems: ShellNavItemDeclarationAst[] = [];
    const controls: ShellControlDeclarationAst[] = [];
    let topBar: ShellTopBarDeclarationAst | undefined;
    let navDrawer: ShellNavDrawerDeclarationAst | undefined;
    this.consumeLineEnd("SHELL declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.SHELL", this.current());
      }

      if (this.checkEnd("SHELL")) {
        const end = this.parseEnd("SHELL");
        return {
          kind: "ShellDeclaration",
          navItems,
          controls,
          ...(topBar === undefined ? {} : { topBar }),
          ...(navDrawer === undefined ? {} : { navDrawer }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      // `NAV_DRAWER` is tested before `NAV` because the dotted spelling starts
      // with the same word as a navigation item.
      if (this.checkWord("NAV_DRAWER") || this.checkDottedWord("NAV", "DRAWER")) {
        navDrawer = this.parseShellNavDrawer();
      } else if (this.checkWord("NAV")) {
        navItems.push(this.parseShellNavItem());
      } else if (this.checkWord("CONTROL")) {
        controls.push(this.parseShellControl());
      } else if (this.checkWord("TOP_BAR") || this.checkDottedWord("TOP", "BAR")) {
        topBar = this.parseShellTopBar();
      } else {
        this.failUnexpected("SHELL directive NAV, NAV_DRAWER, CONTROL, TOP_BAR, or END.SHELL");
      }
    }
  }

  private parseShellNavItem(): ShellNavItemDeclarationAst {
    const startToken = this.expectWord("NAV", "SHELL NAV declaration");
    const view = this.consumeName("shell navigation view name");
    let name: string | undefined;
    let label: string | undefined;
    let icon: string | undefined;
    let group: string | undefined;
    let order: number | undefined;
    let activeWhen: string[] = [];
    let visibility: ShellVisibilityDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("AS")) {
        name = this.consumeName("shell navigation item name");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("shell navigation label"));
      } else if (this.matchWord("ICON")) {
        icon = this.consumeName("shell navigation icon");
      } else if (this.matchWord("GROUP")) {
        group = this.consumeName("shell navigation group");
      } else if (this.matchWord("ORDER")) {
        order = this.consumeNumber("shell navigation order");
      } else if (this.matchWord("ACTIVE_WHEN") || this.matchDottedWord("ACTIVE", "WHEN")) {
        activeWhen = this.consumeNameListUntilLine("shell navigation active views");
        break;
      } else if (this.matchWord("VISIBLE")) {
        visibility = this.parseShellVisibility();
      } else {
        this.failUnexpected(
          "SHELL NAV option AS, LABEL, ICON, GROUP, ORDER, ACTIVE_WHEN, VISIBLE, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL NAV declaration");

    return {
      kind: "ShellNavItemDeclaration",
      ...(name === undefined ? {} : { name }),
      view,
      ...(label === undefined ? {} : { label }),
      ...(icon === undefined ? {} : { icon }),
      ...(group === undefined ? {} : { group }),
      ...(order === undefined ? {} : { order }),
      activeWhen,
      ...(visibility === undefined ? {} : { visibility }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellControl(): ShellControlDeclarationAst {
    const startToken = this.expectWord("CONTROL", "SHELL CONTROL declaration");
    const name = this.consumeName("shell control name");
    let controlKind: ShellControlKind | undefined;
    let label: string | undefined;
    let icon: string | undefined;
    let placement: ShellControlPlacement | undefined;
    let visibility: ShellVisibilityDeclarationAst | undefined;
    let context: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("KIND")) {
        controlKind = this.parseShellControlKind();
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("shell control label"));
      } else if (this.matchWord("ICON")) {
        icon = this.consumeName("shell control icon");
      } else if (this.matchWord("PLACEMENT")) {
        placement = this.parseShellControlPlacement();
      } else if (this.matchWord("VISIBLE")) {
        visibility = this.parseShellVisibility();
      } else if (this.matchWord("CONTEXT")) {
        context = this.consumeName("shell control context");
      } else {
        this.failUnexpected(
          "SHELL CONTROL option KIND, LABEL, ICON, PLACEMENT, VISIBLE, CONTEXT, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL CONTROL declaration");

    return {
      kind: "ShellControlDeclaration",
      name,
      controlKind: controlKind ?? "syncStatus",
      ...(label === undefined ? {} : { label }),
      ...(icon === undefined ? {} : { icon }),
      ...(placement === undefined ? {} : { placement }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(context === undefined ? {} : { context }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellTopBar(): ShellTopBarDeclarationAst {
    const startToken = this.checkWord("TOP_BAR")
      ? this.expectWord("TOP_BAR", "SHELL TOP_BAR declaration")
      : this.expectDottedWord("TOP", "BAR", "SHELL TOP.BAR declaration");
    let contextSelector: ShellContextSelectorPlacement | undefined;
    let mobileContextSelector: ShellMobileContextSelectorMode | undefined;
    // Left undeclared rather than defaulted to empty: an empty list means
    // "render no controls", which is not what omitting the clause asks for.
    // Resolution falls back to the controls that declared `PLACEMENT topBar`.
    let controls: string[] | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("CONTEXT_SELECTOR")) {
        contextSelector = this.parseShellContextSelectorPlacement();
      } else if (this.matchWord("MOBILE_CONTEXT_SELECTOR")) {
        mobileContextSelector = this.parseShellMobileContextSelectorMode();
      } else if (this.matchWord("CONTROLS")) {
        controls = this.consumeNameListUntilLine("SHELL TOP_BAR controls");
        break;
      } else {
        this.failUnexpected(
          "SHELL TOP_BAR option CONTEXT_SELECTOR, MOBILE_CONTEXT_SELECTOR, CONTROLS, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL TOP_BAR declaration");

    return {
      kind: "ShellTopBarDeclaration",
      ...(contextSelector === undefined ? {} : { contextSelector }),
      ...(mobileContextSelector === undefined ? {} : { mobileContextSelector }),
      ...(controls === undefined ? {} : { controls }),
      range: this.rangeFrom(startToken),
    };
  }

  /**
   * ```text
   * NAV_DRAWER TITLE 'Giggle Band' CONTROLS themeSwitch logout
   * ```
   *
   * Both clauses are optional. An omitted `CONTROLS` leaves `controls`
   * undefined rather than empty so resolution can still fall back to whichever
   * controls declared `PLACEMENT navDrawer`.
   */
  private parseShellNavDrawer(): ShellNavDrawerDeclarationAst {
    const startToken = this.checkWord("NAV_DRAWER")
      ? this.expectWord("NAV_DRAWER", "SHELL NAV_DRAWER declaration")
      : this.expectDottedWord("NAV", "DRAWER", "SHELL NAV.DRAWER declaration");
    let title: string | undefined;
    let controls: string[] | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("TITLE")) {
        title = String(this.consumeLiteral("SHELL NAV_DRAWER title"));
      } else if (this.matchWord("CONTROLS")) {
        controls = this.consumeNameListUntilLine("SHELL NAV_DRAWER controls");
        break;
      } else {
        this.failUnexpected("SHELL NAV_DRAWER option TITLE, CONTROLS, or end of line");
      }
    }
    this.consumeLineEnd("SHELL NAV_DRAWER declaration");

    return {
      kind: "ShellNavDrawerDeclaration",
      ...(title === undefined ? {} : { title }),
      ...(controls === undefined ? {} : { controls }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellVisibility(): ShellVisibilityDeclarationAst {
    if (this.matchWord("ALWAYS")) {
      return { kind: "always" };
    }

    if (this.matchWord("ONLINE")) {
      return { kind: "online" };
    }

    if (this.matchWord("OFFLINE")) {
      return { kind: "offline" };
    }

    this.expectWord("WHEN", "SHELL visibility WHEN clause");
    if (this.matchWord("CONTEXT")) {
      const context = this.consumeName("SHELL visibility context");
      if (this.matchWord("AVAILABLE")) {
        return { kind: "contextAvailable", context };
      }
      if (this.matchWord("SELECTED")) {
        return { kind: "contextSelected", context };
      }
      this.failUnexpected("SHELL visibility CONTEXT condition AVAILABLE or SELECTED");
    }

    this.failUnexpected("SHELL visibility condition CONTEXT, ONLINE, OFFLINE, or ALWAYS");
  }

  private parseBusinessContext(): BusinessContextDeclarationAst {
    const startToken = this.expectWord("CONTEXT", "CONTEXT declaration");
    const name = this.consumeName("context name");
    let object: string | undefined;
    let selection: BusinessContextDeclarationAst["selection"];
    let membership: BusinessContextDeclarationAst["membership"];

    while (!this.isLineEnd()) {
      if (this.matchWord("OBJECT")) {
        object = this.consumeName("context object name");
      } else if (this.matchWord("SELECTION")) {
        selection = {
          ...(selection ?? {}),
          mode: this.parseContextSelectionMode(),
        };
      } else if (this.matchWord("AUTO_SELECT")) {
        selection = {
          ...(selection ?? {}),
          autoSelect: this.consumeBooleanValue("context AUTO_SELECT value"),
        };
      } else if (this.matchWord("PERSISTENCE")) {
        selection = {
          ...(selection ?? {}),
          persistence: this.parseContextSelectionPersistence(),
        };
      } else if (this.matchWord("SOURCE")) {
        selection = {
          ...(selection ?? {}),
          source: this.parseContextSelectionSource(),
        };
      } else if (this.matchWord("ROUTE_PARAM")) {
        selection = {
          ...(selection ?? {}),
          routeParam: this.consumeName("context route parameter"),
        };
      } else if (this.matchWord("MEMBERSHIP")) {
        membership = this.parseContextMembership();
      } else {
        this.failUnexpected(
          "CONTEXT option OBJECT, SELECTION, AUTO_SELECT, PERSISTENCE, SOURCE, ROUTE_PARAM, MEMBERSHIP, or end of line",
        );
      }
    }

    this.consumeLineEnd("CONTEXT declaration");
    return {
      kind: "BusinessContextDeclaration",
      name,
      ...(object === undefined ? {} : { object }),
      ...(selection === undefined ? {} : { selection }),
      ...(membership === undefined ? {} : { membership }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseContextMembership(): BusinessContextDeclarationAst["membership"] {
    const object = this.consumeName("context membership object");
    let userField: string | undefined;
    let contextField: string | undefined;
    let roleField: string | undefined;
    let roles: string[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("USER")) {
        userField = this.consumeName("context membership user field");
      } else if (this.matchWord("CONTEXT_FIELD") || this.matchWord("CONTEXT")) {
        contextField = this.consumeName("context membership context field");
      } else if (this.matchWord("ROLE_FIELD") || this.matchWord("ROLE")) {
        roleField = this.consumeName("context membership role field");
      } else if (this.matchWord("ROLES")) {
        roles = this.consumeNameListUntilLine("context membership roles");
      } else {
        this.failUnexpected(
          "CONTEXT MEMBERSHIP option USER, CONTEXT_FIELD, ROLE_FIELD, ROLES, or end of line",
        );
      }
    }

    if (userField === undefined) {
      this.failExpected("USER field in CONTEXT MEMBERSHIP", this.previous());
    }
    if (contextField === undefined) {
      this.failExpected("CONTEXT_FIELD in CONTEXT MEMBERSHIP", this.previous());
    }
    if (roleField === undefined) {
      this.failExpected("ROLE_FIELD in CONTEXT MEMBERSHIP", this.previous());
    }

    return {
      object,
      userField,
      contextField,
      roleField,
      roles,
    };
  }

  /**
   * ```text
   * CONTEXT_GRANT pendingBandInvitation ON Band OBJECT BandInvitation USER Invitee CONTEXT_FIELD Band WHEN Status == 'Pending'
   * ```
   *
   * A grant is a one-line top-level declaration rather than a `CONTEXT` option
   * because it names an object the context never mentions, and a context may
   * have several. `ON` says which context it attaches to.
   */
  private parseContextGrant(): ContextGrantDeclarationAst {
    const startToken = this.checkWord("CONTEXT_GRANT")
      ? this.expectWord("CONTEXT_GRANT", "CONTEXT_GRANT declaration")
      : this.expectDottedWord("CONTEXT", "GRANT", "CONTEXT.GRANT declaration");
    const name = this.consumeName("context grant name");
    let context: string | undefined;
    let contextToken: Token | undefined;
    let object: string | undefined;
    let userField: string | undefined;
    let contextField: string | undefined;
    let condition: ResolvedExpression | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("ON")) {
        contextToken = this.current();
        context = this.consumeName("context grant target context");
      } else if (this.matchWord("OBJECT")) {
        object = this.consumeName("context grant object");
      } else if (this.matchWord("USER")) {
        userField = this.consumeName("context grant user field");
      } else if (this.matchWord("CONTEXT_FIELD") || this.matchWord("CONTEXT")) {
        contextField = this.consumeName("context grant context field");
      } else if (this.matchWord("WHEN")) {
        condition = this.parseExpressionUntil(new Set());
      } else {
        this.failUnexpected(
          "CONTEXT_GRANT option ON, OBJECT, USER, CONTEXT_FIELD, WHEN, or end of line",
        );
      }
    }

    if (context === undefined || contextToken === undefined) {
      this.failExpected("ON context in CONTEXT_GRANT", this.previous());
    }
    if (object === undefined) {
      this.failExpected("OBJECT in CONTEXT_GRANT", this.previous());
    }
    if (userField === undefined) {
      this.failExpected("USER field in CONTEXT_GRANT", this.previous());
    }
    if (contextField === undefined) {
      this.failExpected("CONTEXT_FIELD in CONTEXT_GRANT", this.previous());
    }

    this.consumeLineEnd("CONTEXT_GRANT declaration");
    this.contextGrantTargets.push({ context, token: contextToken });

    return {
      kind: "ContextGrantDeclaration",
      name,
      context,
      object,
      userField,
      contextField,
      ...(condition === undefined ? {} : { condition }),
      range: this.rangeFrom(startToken),
    };
  }

  /**
   * A grant only exists as an entry on a context's `grants` array, so one naming
   * a context this document never declares has nowhere to land. Dropping it
   * would silently disable an access route, and inventing the context would
   * silently create one; refusing the source is the only honest option, and it
   * is checked at end of document so declaration order stays free.
   */
  private requireDeclaredContextsForGrants(
    contexts: BusinessContextDeclarationAst[],
    grants: ContextGrantDeclarationAst[],
  ): void {
    if (grants.length === 0) {
      return;
    }

    const declared = new Set(contexts.map((context) => context.name));

    for (const target of this.contextGrantTargets) {
      if (declared.has(target.context)) {
        continue;
      }

      const known = [...declared].join(", ");
      this.fail(
        "ADL_PARSE_UNEXPECTED_TOKEN",
        `Expected CONTEXT_GRANT ON to name a declared CONTEXT (${
          known.length === 0 ? "none declared" : known
        }), but found '${target.context}'.`,
        target.token,
      );
    }
  }

  private parseObject(): ObjectDeclarationAst {
    const startToken = this.expectWord("OBJECT", "OBJECT declaration");
    const name = this.consumeName("object name");
    let businessKey: string | undefined;
    let displayField: string | undefined;
    let schemaVersion: number | undefined;
    let lifecycle: LifecycleDeclarationAst | undefined;
    let sync: SyncDeclarationAst | undefined;
    let scope: ObjectScopeDeclarationAst | undefined;
    const fields: FieldDeclarationAst[] = [];
    const computedFields: ComputedFieldDeclarationAst[] = [];
    const constraints: ObjectConstraintDeclarationAst[] = [];
    const validations: ObjectValidationDeclarationAst[] = [];
    const views: ViewDeclarationAst[] = [];
    const policyRefs: string[] = [];
    this.consumeLineEnd("OBJECT declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.OBJECT", this.current());
      }

      if (this.checkEnd("OBJECT")) {
        const end = this.parseEnd("OBJECT");
        return {
          kind: "ObjectDeclaration",
          name,
          ...(businessKey === undefined ? {} : { businessKey }),
          ...(displayField === undefined ? {} : { displayField }),
          ...(schemaVersion === undefined ? {} : { schemaVersion }),
          fields,
          computedFields,
          ...(scope === undefined ? {} : { scope }),
          constraints,
          validations,
          ...(lifecycle === undefined ? {} : { lifecycle }),
          views,
          ...(sync === undefined ? {} : { sync }),
          policyRefs,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("KEY")) {
        businessKey = this.consumeName("business key field name");
        this.consumeLineEnd("OBJECT KEY directive");
      } else if (this.matchWord("DISPLAY")) {
        displayField = this.consumeName("display field name");
        this.consumeLineEnd("OBJECT DISPLAY directive");
      } else if (this.matchWord("SCHEMA_VERSION") || this.matchDottedWord("SCHEMA", "VERSION")) {
        // Without this an object could never leave schema version 1, which made
        // `SCHEMA_VERSION` inside a MIGRATION block unusable from ADL source: a
        // migration bumping a record to 2 was refused because the model still
        // said 1, so the only legal value was the one that changes nothing.
        schemaVersion = this.consumeNumber("OBJECT SCHEMA_VERSION value");
        this.consumeLineEnd("OBJECT SCHEMA_VERSION directive");
      } else if (this.checkWord("FIELD")) {
        fields.push(this.parseField());
      } else if (this.checkWord("COMPUTED")) {
        computedFields.push(this.parseComputedField());
      } else if (this.checkWord("SCOPE")) {
        scope = this.parseObjectScope();
      } else if (this.checkWord("CONSTRAINT")) {
        constraints.push(this.parseObjectConstraint());
      } else if (this.checkWord("VALIDATE") || this.checkWord("VALIDATION")) {
        validations.push(this.parseObjectValidation());
      } else if (this.checkWord("LIFECYCLE")) {
        lifecycle = this.parseLifecycle();
      } else if (this.checkWord("VIEW")) {
        views.push(this.parseView());
      } else if (this.checkWord("SYNC")) {
        sync = this.parseSync(true);
      } else if (this.matchWord("POLICY")) {
        policyRefs.push(...this.consumeNameListUntilLine("object policy reference list"));
        this.consumeLineEnd("OBJECT POLICY directive");
      } else {
        this.failUnexpected(
          "OBJECT directive KEY, DISPLAY, FIELD, COMPUTED, LIFECYCLE, VIEW, SYNC, POLICY, or END.OBJECT",
        );
      }
    }
  }

  private parseComputedField(): ComputedFieldDeclarationAst {
    const startToken = this.expectWord("COMPUTED", "COMPUTED field declaration");
    if (this.matchWord("FIELD")) {
      // Optional readability word.
    }
    const name = this.consumeName("computed field name");
    const { type } = this.parseFieldType();
    if (!this.matchSymbol("=") && !this.matchWord("AS")) {
      this.failExpected("= or AS before computed field expression", this.current());
    }
    const expression = this.parseExpressionUntil(new Set());
    this.consumeLineEnd("COMPUTED field declaration");

    return {
      kind: "ComputedFieldDeclaration",
      name,
      type,
      expression,
      range: this.rangeFrom(startToken),
    };
  }

  private parseObjectScope(): ObjectScopeDeclarationAst {
    const startToken = this.expectWord("SCOPE", "OBJECT SCOPE declaration");
    const context = this.consumeName("object scope context");
    let field: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("FIELD")) {
        field = this.consumeName("object scope field");
      } else {
        this.failUnexpected("OBJECT SCOPE option FIELD or end of line");
      }
    }

    if (field === undefined) {
      this.failExpected("FIELD in OBJECT SCOPE declaration", this.previous());
    }

    this.consumeLineEnd("OBJECT SCOPE declaration");
    return {
      kind: "ObjectScopeDeclaration",
      context,
      field,
      range: this.rangeFrom(startToken),
    };
  }

  private parseObjectConstraint(): ObjectConstraintDeclarationAst {
    const startToken = this.expectWord("CONSTRAINT", "OBJECT CONSTRAINT declaration");
    const name = this.consumeName("object constraint name");
    const constraintKind = normaliseKeyword(this.consumeName("object constraint kind"));

    if (constraintKind === "unique") {
      let scopeFields: string[] = [];
      let fields: string[] = [];

      while (!this.isLineEnd()) {
        if (this.matchWord("SCOPE")) {
          scopeFields = this.consumeNameListUntilWords(
            "unique constraint scope fields",
            new Set(["FIELDS"]),
          );
        } else if (this.matchWord("FIELDS") || this.matchWord("FIELD")) {
          fields = this.consumeNameListUntilLine("unique constraint fields");
        } else {
          this.failUnexpected("UNIQUE CONSTRAINT option SCOPE, FIELDS, or end of line");
        }
      }

      this.consumeLineEnd("OBJECT CONSTRAINT declaration");
      return {
        kind: "UniqueObjectConstraintDeclaration",
        name,
        fields,
        scopeFields,
        range: this.rangeFrom(startToken),
      };
    }

    if (constraintKind === "ordered") {
      let parentField: string | undefined;
      let positionField: string | undefined;
      let scopeFields: string[] = [];
      let minPosition: number | undefined;
      let reorder: OrderedCollectionReorder | undefined;
      let compaction: OrderedCollectionCompaction | undefined;

      while (!this.isLineEnd()) {
        if (this.matchWord("SCOPE")) {
          scopeFields = this.consumeNameListUntilWords(
            "ordered constraint scope fields",
            new Set(["PARENT", "POSITION", "MIN", "REORDER", "COMPACT"]),
          );
        } else if (this.matchWord("PARENT")) {
          parentField = this.consumeName("ordered constraint parent field");
        } else if (this.matchWord("POSITION")) {
          positionField = this.consumeName("ordered constraint position field");
        } else if (this.matchWord("MIN")) {
          minPosition = this.consumeIntegerModifierValue("ordered constraint min position");
        } else if (this.matchWord("REORDER")) {
          reorder = this.parseOrderedCollectionReorder();
        } else if (this.matchWord("COMPACT")) {
          compaction = this.parseOrderedCollectionCompaction();
        } else {
          this.failUnexpected(
            "ORDERED CONSTRAINT option SCOPE, PARENT, POSITION, MIN, REORDER, COMPACT, or end of line",
          );
        }
      }

      if (parentField === undefined) {
        this.failExpected("PARENT field in ORDERED constraint", this.previous());
      }
      if (positionField === undefined) {
        this.failExpected("POSITION field in ORDERED constraint", this.previous());
      }

      this.consumeLineEnd("OBJECT CONSTRAINT declaration");
      return {
        kind: "OrderedObjectConstraintDeclaration",
        name,
        parentField,
        positionField,
        scopeFields,
        ...(minPosition === undefined ? {} : { minPosition }),
        ...(reorder === undefined ? {} : { reorder }),
        ...(compaction === undefined ? {} : { compaction }),
        range: this.rangeFrom(startToken),
      };
    }

    this.failExpected("object constraint kind UNIQUE or ORDERED", this.previous());
  }

  private parseOrderedCollectionReorder(): OrderedCollectionReorder {
    const token = this.consumeWordToken("ordered constraint reorder mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "strict":
        return "strict";
      case "shift":
        return "shift";
      default:
        this.failExpected("ORDERED CONSTRAINT REORDER mode STRICT or SHIFT", token);
    }
  }

  private parseOrderedCollectionCompaction(): OrderedCollectionCompaction {
    const token = this.consumeWordToken("ordered constraint compaction mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "none":
        return "none";
      case "ondelete":
        return "onDelete";
      default:
        this.failExpected("ORDERED CONSTRAINT COMPACT mode NONE or ON_DELETE", token);
    }
  }

  private parseField(): FieldDeclarationAst {
    const startToken = this.expectWord("FIELD", "FIELD declaration");
    const name = this.consumeName("field name");
    const { type, validators } = this.parseFieldType();
    let required = false;
    let defaultValue: JsonValue | undefined;
    let readonly = false;
    let hidden = false;
    let lookup: LookupDeclarationAst | undefined;
    let autoId: AutoIdDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("REQUIRED")) {
        required = true;
      } else if (this.matchWord("OPTIONAL")) {
        required = false;
      } else if (this.matchWord("DEFAULT")) {
        defaultValue = this.consumeModifierValue("DEFAULT value");
      } else if (this.matchWord("EMAIL")) {
        validators.push(this.validator("email", startToken));
      } else if (this.matchWord("MIN")) {
        validators.push(
          this.validator("min", this.previous(), this.consumeModifierValue("MIN value")),
        );
      } else if (this.matchWord("MAX")) {
        validators.push(
          this.validator("max", this.previous(), this.consumeModifierValue("MAX value")),
        );
      } else if (this.matchWord("MIN_LENGTH")) {
        validators.push(
          this.validator(
            "minLength",
            this.previous(),
            this.consumeModifierValue("MIN_LENGTH value"),
          ),
        );
      } else if (this.matchWord("MAX_LENGTH")) {
        validators.push(
          this.validator(
            "maxLength",
            this.previous(),
            this.consumeModifierValue("MAX_LENGTH value"),
          ),
        );
      } else if (this.matchWord("IN")) {
        validators.push(this.validator("in", this.previous(), this.consumeValueList("IN values")));
      } else if (this.matchWord("REGEXP")) {
        validators.push(
          this.validator("regexp", this.previous(), this.consumeModifierValue("REGEXP value")),
        );
      } else if (this.matchWord("CURRENCY_CODE")) {
        validators.push(this.validator("currencyCode", this.previous()));
      } else if (this.matchWord("MAX_SIZE")) {
        validators.push(
          this.validator("maxSize", this.previous(), this.consumeModifierValue("MAX_SIZE value")),
        );
      } else if (this.matchWord("MIME_TYPE")) {
        validators.push(
          this.validator("mimeType", this.previous(), this.consumeModifierValue("MIME_TYPE value")),
        );
      } else if (this.matchWord("VALIDATE") || this.matchWord("PREDICATE")) {
        const validatorStart = this.previous();
        const expression = this.parseExpressionUntil(new Set(["MESSAGE"]));
        let message: string | undefined;
        if (this.matchWord("MESSAGE")) {
          message = String(this.consumeLiteral("predicate validator message"));
        }
        validators.push(this.predicateValidator(validatorStart, expression, message));
      } else if (this.matchWord("READONLY")) {
        readonly = true;
      } else if (this.matchWord("HIDDEN")) {
        hidden = true;
      } else if (this.matchWord("AUTO_ID") || this.matchDottedWord("AUTO", "ID")) {
        autoId = this.ensureAutoId(autoId, this.previous());
      } else if (this.matchWord("PREFIX")) {
        autoId = this.ensureAutoId(autoId, this.previous());
        autoId.prefix = String(this.consumeModifierValue("AUTO_ID PREFIX value"));
      } else if (this.matchWord("PAD")) {
        autoId = this.ensureAutoId(autoId, this.previous());
        autoId.pad = this.consumeIntegerModifierValue("AUTO_ID PAD value");
      } else if (this.matchWord("SCOPE")) {
        autoId = this.ensureAutoId(autoId, this.previous());
        autoId.scopeField = this.consumeName("AUTO_ID scope field");
      } else if (this.checkWord("LOOKUP")) {
        lookup = this.parseLookup();
      } else {
        this.failUnexpected("FIELD modifier or end of line");
      }
    }

    this.consumeLineEnd("FIELD declaration");
    return {
      kind: "FieldDeclaration",
      name,
      type,
      required,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      validators,
      readonly,
      hidden,
      ...(lookup === undefined ? {} : { lookup }),
      ...(autoId === undefined ? {} : { autoId }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseObjectValidation(): ObjectValidationDeclarationAst {
    const startToken = this.current();
    if (!this.matchWord("VALIDATE")) {
      this.expectWord("VALIDATION", "object validation declaration");
    }
    const name = this.consumeName("object validation name");
    if (this.matchWord("WHEN")) {
      // WHEN is optional noise after the validation name.
    }
    const expression = this.parseExpressionUntil(new Set(["MESSAGE"]));
    let message: string | undefined;
    if (this.matchWord("MESSAGE")) {
      message = String(this.consumeLiteral("object validation message"));
    }
    this.consumeLineEnd("object validation declaration");
    return {
      kind: "ObjectValidationDeclaration",
      name,
      expression,
      ...(message === undefined ? {} : { message }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseLookup(): LookupDeclarationAst {
    const startToken = this.expectWord("LOOKUP", "LOOKUP field modifier");
    const targetObject = this.consumeName("lookup target object");
    let targetField: string | undefined;
    let displayField: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("TARGET_FIELD")) {
        targetField = this.consumeName("lookup target field");
      } else if (this.matchWord("DISPLAY")) {
        displayField = this.consumeName("lookup display field");
      } else {
        break;
      }
    }

    if (displayField === undefined) {
      this.failExpected("DISPLAY field in LOOKUP modifier", this.current());
    }

    return {
      kind: "LookupDeclaration",
      targetObject,
      ...(targetField === undefined ? {} : { targetField }),
      displayField,
      range: this.rangeFrom(startToken),
    };
  }

  private parseLifecycle(): LifecycleDeclarationAst {
    const startToken = this.expectWord("LIFECYCLE", "LIFECYCLE declaration");
    const name = this.consumeName("lifecycle name");
    let stateField: string | undefined;
    let initialState: string | undefined;
    const states: StateDeclarationAst[] = [];
    const actions: ActionDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("FIELD")) {
        stateField = this.consumeName("lifecycle state field");
      } else if (this.matchWord("INITIAL")) {
        initialState = this.consumeName("initial lifecycle state");
      } else {
        this.failUnexpected("LIFECYCLE header option FIELD, INITIAL, or end of line");
      }
    }
    this.consumeLineEnd("LIFECYCLE declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.LIFECYCLE", this.current());
      }

      if (this.checkEnd("LIFECYCLE")) {
        const end = this.parseEnd("LIFECYCLE");
        return {
          kind: "LifecycleDeclaration",
          name,
          ...(stateField === undefined ? {} : { stateField }),
          ...(initialState === undefined ? {} : { initialState }),
          states,
          actions,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("STATE")) {
        states.push(this.parseState());
      } else if (this.checkWord("ACTION")) {
        actions.push(this.parseAction());
      } else {
        this.failUnexpected("LIFECYCLE directive STATE, ACTION, or END.LIFECYCLE");
      }
    }
  }

  private parseState(): StateDeclarationAst {
    const startToken = this.expectWord("STATE", "STATE declaration");
    const name = this.consumeName("state name");
    let terminal = false;

    while (!this.isLineEnd()) {
      if (this.matchWord("TERMINAL")) {
        terminal = true;
      } else {
        this.failUnexpected("STATE modifier TERMINAL or end of line");
      }
    }

    this.consumeLineEnd("STATE declaration");
    return {
      kind: "StateDeclaration",
      name,
      terminal,
      range: this.rangeFrom(startToken),
    };
  }

  private parseAction(): ActionDeclarationAst {
    const startToken = this.expectWord("ACTION", "ACTION declaration");
    const name = this.consumeName("action name");
    this.expectWord("FROM", "ACTION FROM clause");
    const from = this.consumeStateListUntilTo();
    this.expectWord("TO", "ACTION TO clause");
    const to = this.consumeName("action target state");
    let label: string | undefined;
    const policyRefs: string[] = [];
    const allowRules: ActionAllowDeclarationAst[] = [];
    const guards: LifecycleGuardDeclarationAst[] = [];
    const hooks: HookRefsAst = { before: [], after: [], onError: [] };

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = this.consumeName("action label");
      } else if (this.matchWord("POLICY") || this.matchWord("POLICIES")) {
        policyRefs.push(...this.consumeNameListUntilLine("action policy reference list"));
      } else if (this.matchWord("WHEN")) {
        guards.push(this.parseLifecycleGuardFromCurrent(startToken, `${name}Guard`, true));
      } else {
        this.failUnexpected("ACTION header option LABEL, POLICY, WHEN, or end of line");
      }
    }
    this.consumeLineEnd("ACTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ACTION", this.current());
      }

      if (this.checkEnd("ACTION")) {
        const end = this.parseEnd("ACTION");
        return {
          kind: "ActionDeclaration",
          name,
          from,
          to,
          ...(label === undefined ? {} : { label }),
          guards,
          policyRefs,
          allowRules,
          hooks,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("ALLOW")) {
        allowRules.push(this.parseActionAllow());
      } else if (this.matchWord("WHEN")) {
        guards.push(this.parseLifecycleGuardFromCurrent(this.previous(), `${name}Guard`, false));
      } else if (this.matchWord("POLICY") || this.matchWord("POLICIES")) {
        policyRefs.push(...this.consumeNameListUntilLine("action policy reference list"));
        this.consumeLineEnd("ACTION POLICY directive");
      } else if (this.matchWord("BEFORE")) {
        hooks.before.push(...this.consumeQualifiedNameListUntilLine("BEFORE hook list"));
        this.consumeLineEnd("ACTION BEFORE directive");
      } else if (this.matchWord("AFTER")) {
        hooks.after.push(...this.consumeQualifiedNameListUntilLine("AFTER hook list"));
        this.consumeLineEnd("ACTION AFTER directive");
      } else if (this.matchWord("ON_ERROR")) {
        hooks.onError.push(...this.consumeQualifiedNameListUntilLine("ON_ERROR hook list"));
        this.consumeLineEnd("ACTION ON_ERROR directive");
      } else {
        this.failUnexpected(
          "ACTION directive ALLOW, WHEN, POLICY, BEFORE, AFTER, ON_ERROR, or END.ACTION",
        );
      }
    }
  }

  private parseActionAllow(): ActionAllowDeclarationAst {
    const startToken = this.expectWord("ALLOW", "ACTION ALLOW declaration");
    let roles: string[] = [];
    let states: string[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("ROLE") || this.matchWord("ROLES")) {
        roles = this.consumeNameListUntilWords("role list", new Set(["STATE"]));
      } else if (this.matchWord("STATE")) {
        states = this.consumeNameListUntilLine("state list");
      } else if (this.matchWord("EVERYONE")) {
        roles = [];
      } else {
        this.failUnexpected("ACTION ALLOW option ROLE, EVERYONE, STATE, or end of line");
      }
    }

    this.consumeLineEnd("ACTION ALLOW declaration");
    return {
      kind: "ActionAllowDeclaration",
      roles,
      states,
      range: this.rangeFrom(startToken),
    };
  }

  private parseLifecycleGuardFromCurrent(
    startToken: Token,
    fallbackName: string,
    inHeader: boolean,
  ): LifecycleGuardDeclarationAst {
    const stopWords = inHeader
      ? new Set(["MESSAGE", "LABEL", "POLICY", "POLICIES"])
      : new Set(["MESSAGE"]);
    const expression = this.parseExpressionUntil(stopWords);
    let message: string | undefined;

    if (this.matchWord("MESSAGE")) {
      message = String(this.consumeLiteral("lifecycle guard message"));
    }

    if (!inHeader) {
      this.consumeLineEnd("ACTION WHEN directive");
    }

    return {
      kind: "LifecycleGuardDeclaration",
      name: fallbackName,
      expression,
      ...(message === undefined ? {} : { message }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseView(): ViewDeclarationAst {
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
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("CONTEXT")) {
        context = this.parseViewContextAfterKeyword();
        this.consumeLineEnd("VIEW CONTEXT directive");
      } else if (this.matchWord("READ_MODEL") || this.matchDottedWord("READ", "MODEL")) {
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
    const startToken = this.expectWord("PICKER", "PICKER declaration");
    const name = this.consumeName("relationship picker name");
    let sourceKind: RelationshipPickerSourceKind | undefined;
    let source: string | undefined;
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
          ...(selection === undefined ? {} : { selection }),
          displayFields,
          searchFields,
          sort,
          ...(excludeAlreadyLinked === undefined ? {} : { excludeAlreadyLinked }),
          ...(emptyText === undefined ? {} : { emptyText }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("SOURCE")) {
        sourceKind = this.parseRelationshipPickerSourceKind();
        source = this.consumeName("relationship picker source name");
        this.consumeLineEnd("PICKER SOURCE directive");
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
          "PICKER directive SOURCE, SELECTION, DISPLAY, SEARCH, SORT, EXCLUDE_LINKED, EMPTY_TEXT, or END.PICKER",
        );
      }
    }
  }

  /**
   * A flag directive that means `true` when written alone.
   *
   * `STAGED` and `EXCLUDE_LINKED` both default to `true` in the resolved model,
   * so the bare form has to mean `true` for the word to read as English. The
   * explicit form exists because turning one *off* is otherwise unsayable.
   */
  private parseOptionalBoolean(): boolean {
    return this.isLineEnd() ? true : this.consumeBooleanValue("boolean value");
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

  private parsePresentationState(): PresentationStateDeclarationAst {
    const startToken = this.expectWord("STATE", "VIEW STATE declaration");
    const name = this.consumeName("presentation state name");
    let type: PresentationStateType | undefined;
    let defaultValue: JsonValue | undefined;
    let persistence: PresentationStatePersistence | undefined;

    if (!this.isLineEnd() && !this.checkWord("DEFAULT") && !this.checkWord("PERSISTENCE")) {
      type = this.parsePresentationStateType();
    }

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultValue = this.consumeModifierValue("presentation state DEFAULT value");
      } else if (this.matchWord("PERSISTENCE")) {
        persistence = this.parsePresentationStatePersistence();
      } else {
        this.failUnexpected("VIEW STATE option DEFAULT, PERSISTENCE, or end of line");
      }
    }

    this.consumeLineEnd("VIEW STATE declaration");
    return {
      kind: "PresentationStateDeclaration",
      name,
      ...(type === undefined ? {} : { type }),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(persistence === undefined ? {} : { persistence }),
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationIconMap(): PresentationIconMapDeclarationAst {
    const startToken = this.checkWord("ICON_MAP")
      ? this.expectWord("ICON_MAP", "ICON_MAP declaration")
      : this.expectDottedWord("ICON", "MAP", "ICON.MAP declaration");
    const name = this.consumeName("icon map name");
    this.expectWord("FOR", "ICON_MAP FOR clause");
    const field = this.consumeName("icon map field");
    let defaultIcon: string | undefined;
    const values: PresentationIconMapValueDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultIcon = this.consumeName("icon map default icon");
      } else {
        this.failUnexpected("ICON_MAP header option DEFAULT or end of line");
      }
    }
    this.consumeLineEnd("ICON_MAP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ICON_MAP", this.current());
      }

      if (this.checkEnd("ICON_MAP")) {
        const end = this.parseEnd("ICON_MAP");
        return {
          kind: "PresentationIconMapDeclaration",
          name,
          field,
          values,
          ...(defaultIcon === undefined ? {} : { defaultIcon }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DEFAULT")) {
        defaultIcon = this.consumeName("icon map default icon");
        this.consumeLineEnd("ICON_MAP DEFAULT directive");
      } else {
        values.push(this.parsePresentationIconMapValue());
      }
    }
  }

  private parsePresentationIconMapValue(): PresentationIconMapValueDeclarationAst {
    const startToken = this.current();
    const value = this.consumePrimitiveLiteral("icon map value");
    this.expectSymbol("-", "ICON_MAP value arrow");
    this.expectSymbol(">", "ICON_MAP value arrow");
    const icon = this.consumeName("icon map icon");
    this.consumeLineEnd("ICON_MAP value directive");

    return {
      kind: "PresentationIconMapValueDeclaration",
      value,
      icon,
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationStatus(): PresentationStatusDeclarationAst {
    const startToken = this.expectWord("STATUS", "STATUS declaration");
    const name = this.consumeName("status name");
    let label: string | undefined;
    let accessibleLabel: string | undefined;
    let icon: PresentationIconRefDeclarationAst | undefined;
    let themeToken: PresentationStatusThemeToken | undefined;
    let precedence: number | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("status label"));
      } else if (this.matchWord("ARIA_LABEL") || this.matchDottedWord("ARIA", "LABEL")) {
        accessibleLabel = String(this.consumeLiteral("status accessible label"));
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
      } else if (this.matchWord("THEME")) {
        themeToken = this.parsePresentationStatusThemeToken();
      } else if (this.matchWord("PRECEDENCE")) {
        precedence = Number(this.consumeLiteral("status precedence"));
      } else {
        this.failUnexpected(
          "STATUS option LABEL, ARIA_LABEL, ICON, THEME, PRECEDENCE, or end of line",
        );
      }
    }

    this.consumeLineEnd("STATUS declaration");
    return {
      kind: "PresentationStatusDeclaration",
      name,
      ...(label === undefined ? {} : { label }),
      ...(accessibleLabel === undefined ? {} : { accessibleLabel }),
      ...(icon === undefined ? {} : { icon }),
      ...(themeToken === undefined ? {} : { themeToken }),
      ...(precedence === undefined ? {} : { precedence }),
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationStatusMap(): PresentationStatusMapDeclarationAst {
    const startToken = this.checkWord("STATUS_MAP")
      ? this.expectWord("STATUS_MAP", "STATUS_MAP declaration")
      : this.expectDottedWord("STATUS", "MAP", "STATUS.MAP declaration");
    const name = this.consumeName("status map name");
    this.expectWord("FOR", "STATUS_MAP FOR clause");
    const field = this.consumeName("status map field");
    let defaultStatus: string | undefined;
    const values: PresentationStatusMapValueDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultStatus = this.consumeName("status map default status");
      } else {
        this.failUnexpected("STATUS_MAP header option DEFAULT or end of line");
      }
    }
    this.consumeLineEnd("STATUS_MAP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.STATUS_MAP", this.current());
      }

      if (this.checkEnd("STATUS_MAP")) {
        const end = this.parseEnd("STATUS_MAP");
        return {
          kind: "PresentationStatusMapDeclaration",
          name,
          field,
          values,
          ...(defaultStatus === undefined ? {} : { defaultStatus }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DEFAULT")) {
        defaultStatus = this.consumeName("status map default status");
        this.consumeLineEnd("STATUS_MAP DEFAULT directive");
      } else {
        values.push(this.parsePresentationStatusMapValue());
      }
    }
  }

  private parsePresentationStatusMapValue(): PresentationStatusMapValueDeclarationAst {
    const startToken = this.current();
    const value = this.consumePrimitiveLiteral("status map value");
    this.expectSymbol("-", "STATUS_MAP value arrow");
    this.expectSymbol(">", "STATUS_MAP value arrow");
    const status = this.consumeName("status map status");
    this.consumeLineEnd("STATUS_MAP value directive");

    return {
      kind: "PresentationStatusMapValueDeclaration",
      value,
      status,
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationLegend(): PresentationLegendDeclarationAst {
    const startToken = this.expectWord("LEGEND", "LEGEND declaration");
    const name = this.consumeName("legend name");
    let title: string | undefined;
    let include: PresentationLegendInclude | undefined;
    let statuses: string[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("TITLE")) {
        title = String(this.consumeLiteral("legend title"));
      } else if (this.matchWord("INCLUDE")) {
        include = this.parsePresentationLegendInclude();
      } else if (this.matchWord("STATUSES")) {
        statuses = this.consumeNameListUntilLine("legend status list");
        break;
      } else {
        this.failUnexpected("LEGEND option TITLE, INCLUDE, STATUSES, or end of line");
      }
    }

    this.consumeLineEnd("LEGEND declaration");
    return {
      kind: "PresentationLegendDeclaration",
      name,
      ...(title === undefined ? {} : { title }),
      statuses,
      ...(include === undefined ? {} : { include }),
      range: this.rangeFrom(startToken),
    };
  }

  private parsePresentationSection(): PresentationSectionDeclarationAst {
    const startToken = this.expectWord("SECTION", "SECTION declaration");
    const name = this.consumeName("section name");
    let heading: string | undefined;
    let layout: PresentationLayout | undefined;
    let density: PresentationDensity | undefined;
    const controls: PresentationControlDeclarationAst[] = [];
    const lists: PresentationListDeclarationAst[] = [];
    const calendars: PresentationCalendarDeclarationAst[] = [];
    this.consumeLineEnd("SECTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.SECTION", this.current());
      }

      if (this.checkEnd("SECTION")) {
        const end = this.parseEnd("SECTION");
        return {
          kind: "PresentationSectionDeclaration",
          name,
          ...(heading === undefined ? {} : { heading }),
          ...(layout === undefined ? {} : { layout }),
          ...(density === undefined ? {} : { density }),
          controls,
          lists,
          calendars,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("section heading"));
        this.consumeLineEnd("SECTION HEADING directive");
      } else if (this.matchWord("LAYOUT")) {
        layout = this.parsePresentationLayout();
        this.consumeLineEnd("SECTION LAYOUT directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("SECTION DENSITY directive");
      } else if (this.checkWord("TOGGLE")) {
        controls.push(this.parsePresentationToggle());
      } else if (this.checkWord("ACTION")) {
        controls.push(this.parsePresentationAction());
      } else if (this.checkWord("LIST")) {
        lists.push(this.parsePresentationList());
      } else if (this.checkWord("CALENDAR")) {
        calendars.push(this.parsePresentationCalendar());
      } else {
        this.failUnexpected(
          "SECTION directive HEADING, LAYOUT, DENSITY, TOGGLE, ACTION, LIST, CALENDAR, or END.SECTION",
        );
      }
    }
  }

  private parsePresentationToggle(): PresentationToggleControlDeclarationAst {
    const startToken = this.expectWord("TOGGLE", "TOGGLE declaration");
    const name = this.consumeName("toggle name");
    let state = name;
    let label: string | undefined;
    let icon: PresentationIconRefDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("STATE")) {
        state = this.consumeName("toggle state name");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("toggle label"));
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
      } else {
        this.failUnexpected("TOGGLE header option STATE, LABEL, ICON, or end of line");
      }
    }
    this.consumeLineEnd("TOGGLE declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.TOGGLE", this.current());
      }

      if (this.checkEnd("TOGGLE")) {
        const end = this.parseEnd("TOGGLE");
        return {
          kind: "PresentationToggleControlDeclaration",
          name,
          state,
          ...(label === undefined ? {} : { label }),
          ...(icon === undefined ? {} : { icon }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("STATE")) {
        state = this.consumeName("toggle state name");
        this.consumeLineEnd("TOGGLE STATE directive");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("toggle label"));
        this.consumeLineEnd("TOGGLE LABEL directive");
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
        this.consumeLineEnd("TOGGLE ICON directive");
      } else {
        this.failUnexpected("TOGGLE directive STATE, LABEL, ICON, or END.TOGGLE");
      }
    }
  }

  private parsePresentationList(): PresentationListDeclarationAst {
    const startToken = this.expectWord("LIST", "LIST declaration");
    const name = this.consumeName("list name");
    this.expectWord("FROM", "LIST FROM clause");
    let sourceKind: PresentationListSourceKind | undefined;

    if (this.matchWord("OBJECT")) {
      sourceKind = "object";
    } else if (this.matchWord("READ_MODEL") || this.matchDottedWord("READ", "MODEL")) {
      sourceKind = "readModel";
    }

    const source = this.consumeName("list source");
    let renderAs: PresentationListRenderStyle | undefined;
    let density: PresentationDensity | undefined;
    const sort: SortDeclarationAst[] = [];
    let filter: ResolvedExpression | undefined;
    let emptyText: string | undefined;
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
          sort,
          ...(filter === undefined ? {} : { filter }),
          ...(emptyText === undefined ? {} : { emptyText }),
          statusCandidates,
          actions,
          ...(row === undefined ? {} : { row }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("ORDER")) {
        this.expectWord("BY", "LIST ORDER BY clause");
        sort.push(...this.parseSortList());
        this.consumeLineEnd("LIST ORDER BY directive");
      } else if (this.matchWord("WHERE")) {
        filter = this.parseExpressionUntil(new Set());
        this.consumeLineEnd("LIST WHERE directive");
      } else if (this.matchWord("RENDER_AS") || this.matchDottedWord("RENDER", "AS")) {
        renderAs = this.parsePresentationListRenderStyle();
        this.consumeLineEnd("LIST RENDER_AS directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("LIST DENSITY directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("LIST EMPTY_TEXT value"));
        this.consumeLineEnd("LIST EMPTY_TEXT directive");
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
          "LIST directive ORDER BY, WHERE, RENDER_AS, DENSITY, EMPTY_TEXT, STATUS, ACTION, ROW, or END.LIST",
        );
      }
    }
  }

  private parsePresentationCalendar(): PresentationCalendarDeclarationAst {
    const startToken = this.expectWord("CALENDAR", "CALENDAR declaration");
    const name = this.consumeName("calendar name");
    this.expectWord("FROM", "CALENDAR FROM clause");
    let sourceKind: PresentationCalendarSourceKind | undefined;

    if (this.matchWord("OBJECT")) {
      sourceKind = "object";
    } else if (this.matchWord("READ_MODEL") || this.matchDottedWord("READ", "MODEL")) {
      sourceKind = "readModel";
    }

    const source = this.consumeName("calendar source");
    let dateField: string | undefined;
    let titleField: string | undefined;
    let density: PresentationDensity | undefined;
    let monthValue: string | undefined;
    let monthState: string | undefined;
    let weekStart: PresentationCalendarWeekStart | undefined;
    let minDate: string | undefined;
    let maxDate: string | undefined;
    let emptyText: string | undefined;
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
          ...(minDate === undefined ? {} : { minDate }),
          ...(maxDate === undefined ? {} : { maxDate }),
          statusCandidates,
          actions,
          ...(emptyText === undefined ? {} : { emptyText }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DATE_FIELD") || this.matchDottedWord("DATE", "FIELD")) {
        dateField = this.consumeName("CALENDAR DATE_FIELD value");
        this.consumeLineEnd("CALENDAR DATE_FIELD directive");
      } else if (this.matchWord("TITLE_FIELD") || this.matchDottedWord("TITLE", "FIELD")) {
        titleField = this.consumeName("CALENDAR TITLE_FIELD value");
        this.consumeLineEnd("CALENDAR TITLE_FIELD directive");
      } else if (this.matchWord("SUMMARY_FIELDS") || this.matchDottedWord("SUMMARY", "FIELDS")) {
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
      } else if (this.matchWord("MONTH_STATE") || this.matchDottedWord("MONTH", "STATE")) {
        monthState = this.consumeName("CALENDAR MONTH_STATE value");
        this.consumeLineEnd("CALENDAR MONTH_STATE directive");
      } else if (this.matchWord("WEEK_START") || this.matchDottedWord("WEEK", "START")) {
        weekStart = this.parsePresentationCalendarWeekStart();
        this.consumeLineEnd("CALENDAR WEEK_START directive");
      } else if (this.matchWord("RANGE")) {
        minDate = String(this.consumeLiteral("CALENDAR RANGE start"));
        this.expectWord("TO", "CALENDAR RANGE TO clause");
        maxDate = String(this.consumeLiteral("CALENDAR RANGE end"));
        this.consumeLineEnd("CALENDAR RANGE directive");
      } else if (this.matchWord("EMPTY_TEXT")) {
        emptyText = String(this.consumeLiteral("CALENDAR EMPTY_TEXT value"));
        this.consumeLineEnd("CALENDAR EMPTY_TEXT directive");
      } else if (this.checkWord("STATUS")) {
        statusCandidates.push(this.parsePresentationStatusCandidate());
      } else if (this.checkWord("ACTION")) {
        actions.push(this.parsePresentationAction("secondary"));
      } else if (this.checkWord("END")) {
        this.failExpected("END.CALENDAR", this.current());
      } else {
        this.failUnexpected(
          "CALENDAR directive DATE_FIELD, TITLE_FIELD, SUMMARY_FIELDS, FIELDS, ORDER BY, DENSITY, MONTH, MONTH_STATE, WEEK_START, RANGE, EMPTY_TEXT, STATUS, ACTION, or END.CALENDAR",
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

  private parsePresentationAction(
    defaultPlacement?: PresentationActionPlacement,
  ): PresentationActionControlDeclarationAst {
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

  private parsePresentationRowTemplate(): PresentationRowTemplateDeclarationAst {
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

    while (!this.isLineEnd()) {
      if (this.matchWord("STYLE")) {
        style = this.parsePresentationFragmentStyle();
      } else if (this.matchWord("FORMAT")) {
        format = this.parsePresentationFormat();
      } else {
        this.failUnexpected("TEXT option FORMAT, STYLE, or end of line");
      }
    }
    this.consumeLineEnd("TEXT row fragment");

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

  private parseReadModel(): ReadModelDeclarationAst {
    const startToken = this.checkWord("READ_MODEL")
      ? this.expectWord("READ_MODEL", "READ_MODEL declaration")
      : this.expectDottedWord("READ", "MODEL", "READ.MODEL declaration");
    const name = this.consumeName("read model name");
    let context: ViewContextDeclarationAst | undefined;
    let strategy: ReadModelDeclarationAst["strategy"];
    const sources: ReadModelSourceDeclarationAst[] = [];
    const fields: ReadModelFieldDeclarationAst[] = [];
    const sort: SortDeclarationAst[] = [];
    this.consumeLineEnd("READ_MODEL declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.READ_MODEL", this.current());
      }

      if (this.checkEnd("READ_MODEL")) {
        const end = this.parseEnd("READ_MODEL");
        return {
          kind: "ReadModelDeclaration",
          name,
          ...(context === undefined ? {} : { context }),
          ...(strategy === undefined ? {} : { strategy }),
          sources,
          fields,
          sort,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("CONTEXT")) {
        context = this.parseViewContextAfterKeyword();
        this.consumeLineEnd("READ_MODEL CONTEXT directive");
      } else if (this.matchWord("UNION")) {
        strategy = "union";
        this.consumeLineEnd("READ_MODEL UNION directive");
      } else if (this.checkWord("SOURCE")) {
        sources.push(this.parseReadModelSource());
      } else if (this.checkWord("FIELD")) {
        fields.push(this.parseReadModelField());
      } else if (this.matchWord("SORT")) {
        sort.push(...this.parseSortList());
        this.consumeLineEnd("READ_MODEL SORT directive");
      } else {
        this.failUnexpected(
          "READ_MODEL directive CONTEXT, UNION, SOURCE, FIELD, SORT, or END.READ_MODEL",
        );
      }
    }
  }

  private parseReadModelSource(): ReadModelSourceDeclarationAst {
    const startToken = this.expectWord("SOURCE", "READ_MODEL SOURCE declaration");
    const firstName = this.consumeName("read model source name or object");
    let name = firstName;
    let object = firstName;
    let scope: ReadModelSourceDeclarationAst["scope"];
    let join: ReadModelSourceJoinDeclarationAst | undefined;

    if (this.matchWord("OBJECT")) {
      object = this.consumeName("read model source object");
    } else if (!this.isLineEnd() && !this.currentWordIsAny(READ_MODEL_SOURCE_OPTION_WORDS)) {
      object = this.consumeName("read model source object");
    }

    while (!this.isLineEnd()) {
      if (this.matchWord("SCOPE")) {
        scope = this.parseReadModelSourceScope();
      } else if (this.matchWord("AS")) {
        name = this.consumeName("read model source alias");
      } else if (this.checkWord("JOIN")) {
        join = this.parseReadModelSourceJoin();
      } else if (this.matchWord("CARDINALITY")) {
        if (join === undefined) {
          this.failExpected(
            "JOIN before CARDINALITY in READ_MODEL SOURCE declaration",
            this.previous(),
          );
        }
        join.cardinality = this.parseReadModelJoinCardinality();
      } else {
        this.failUnexpected(
          "READ_MODEL SOURCE option SCOPE, AS, JOIN, CARDINALITY, or end of line",
        );
      }
    }

    this.consumeLineEnd("READ_MODEL SOURCE declaration");
    return {
      kind: "ReadModelSourceDeclaration",
      name,
      object,
      ...(scope === undefined ? {} : { scope }),
      ...(join === undefined ? {} : { join }),
      range: this.rangeFrom(startToken),
    };
  }

  /**
   * ```text
   * JOIN member ON User == member.User
   * ```
   *
   * The left operand is a bare field on the declaring source's object and the
   * right operand is qualified by the joined source, so the direction of the hop
   * is readable without knowing which object owns which field. Either side may
   * be `id`, meaning the record's own identity.
   */
  private parseReadModelSourceJoin(): ReadModelSourceJoinDeclarationAst {
    const startToken = this.expectWord("JOIN", "READ_MODEL SOURCE JOIN clause");
    const source = this.consumeName("read model join source name");
    this.expectWord("ON", "READ_MODEL SOURCE JOIN ON clause");
    const localField = this.consumeName("read model join local field");
    this.expectSymbol("==", "READ_MODEL SOURCE JOIN comparison");
    const qualified = this.consumeQualifiedName("read model join source field");
    const [qualifier, ...fieldParts] = qualified.split(".");

    if (qualifier === undefined || fieldParts.length !== 1) {
      this.failExpected(
        `joined field written as ${source}.<field> in READ_MODEL SOURCE JOIN`,
        this.previous(),
      );
    }

    if (qualifier !== source) {
      this.failExpected(
        `joined field qualified by the joined source '${source}' in READ_MODEL SOURCE JOIN`,
        this.previous(),
      );
    }

    return {
      kind: "ReadModelSourceJoinDeclaration",
      source,
      localField,
      sourceField: fieldParts[0] ?? "",
      range: this.rangeFrom(startToken),
    };
  }

  private parseReadModelJoinCardinality(): ReadModelJoinCardinality {
    const token = this.consumeWordToken("read model join cardinality");

    switch (normaliseKeyword(token.lexeme)) {
      case "one":
        return "one";
      case "many":
        return "many";
      default:
        this.failExpected("READ_MODEL SOURCE JOIN CARDINALITY ONE or MANY", token);
    }
  }

  private parseReadModelField(): ReadModelFieldDeclarationAst {
    const startToken = this.expectWord("FIELD", "READ_MODEL FIELD declaration");
    const name = this.consumeName("read model field name");
    let type: FieldType | undefined;

    if (!this.checkWord("FROM") && !this.checkSymbol("=") && !this.checkWord("AS")) {
      type = this.parseFieldType().type;
    }

    if (this.matchWord("FROM")) {
      const sourcePath = this.consumeQualifiedName("read model source field");
      const [source, ...fieldParts] = sourcePath.split(".");
      if (source === undefined || fieldParts.length === 0) {
        this.failExpected("source.field", this.previous());
      }
      this.consumeLineEnd("READ_MODEL FIELD declaration");
      return {
        kind: "ReadModelFieldDeclaration",
        name,
        ...(type === undefined ? {} : { type }),
        source,
        field: fieldParts.join("."),
        range: this.rangeFrom(startToken),
      };
    }

    if (!this.matchSymbol("=") && !this.matchWord("AS")) {
      this.failExpected("FROM, =, or AS in READ_MODEL FIELD declaration", this.current());
    }
    const expression = this.parseExpressionUntil(new Set());
    this.consumeLineEnd("READ_MODEL FIELD declaration");
    return {
      kind: "ReadModelFieldDeclaration",
      name,
      ...(type === undefined ? {} : { type }),
      expression,
      range: this.rangeFrom(startToken),
    };
  }

  private parseReadModelSourceScope(): ReadModelSourceDeclarationAst["scope"] {
    const token = this.consumeWordToken("read model source scope");

    switch (normaliseKeyword(token.lexeme)) {
      case "all":
        return "all";
      case "currentcontext":
        return "currentContext";
      case "allavailablecontexts":
        return "allAvailableContexts";
      case "currentuser":
        return "currentUser";
      default:
        this.failExpected(
          "read model source scope ALL, CURRENT_CONTEXT, ALL_AVAILABLE_CONTEXTS, or CURRENT_USER",
          token,
        );
    }
  }

  private parseViewContextAfterKeyword(): ViewContextDeclarationAst {
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

  private parseSortList(): SortDeclarationAst[] {
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

  private parsePolicy(): PolicyDeclarationAst {
    const startToken = this.expectWord("POLICY", "POLICY declaration");
    const name = this.consumeName("policy name");
    this.expectWord("ON", "POLICY ON clause");
    const object = this.consumeName("policy object name");
    const rules: PolicyRuleDeclarationAst[] = [];
    this.consumeLineEnd("POLICY declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.POLICY", this.current());
      }

      if (this.checkEnd("POLICY")) {
        const end = this.parseEnd("POLICY");
        return {
          kind: "PolicyDeclaration",
          name,
          object,
          rules,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DEFAULT")) {
        this.expectWord("DENY", "POLICY DEFAULT DENY directive");
        this.consumeLineEnd("POLICY DEFAULT directive");
      } else {
        rules.push(this.parsePolicyRule(rules.length));
      }
    }
  }

  private parsePolicyRule(index: number): PolicyRuleDeclarationAst {
    const startToken = this.current();
    let name: string | undefined;

    if (this.matchWord("RULE")) {
      name = this.consumeName("policy rule name");
    }

    const effect = this.parsePolicyEffect();
    const action = this.parsePolicyAction();
    const principal: PrincipalSelectorAst = {
      roles: [],
      groupRoles: [],
      users: [],
      owner: false,
    };
    const state: string[] = [];
    const fields: string[] = [];
    const channels: RuntimeChannel[] = [];
    let lifecycleAction: string | undefined;
    let condition: ResolvedExpression | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("FIELD") || this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilWords("policy field list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("STATE")) {
        state.push(...this.consumeNameListUntilWords("policy state list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("ACTION")) {
        lifecycleAction = this.consumeName("policy lifecycle action");
      } else if (this.matchWord("CHANNEL") || this.matchWord("CHANNELS")) {
        channels.push(...this.consumeChannelsUntilWords(FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("WHEN")) {
        condition = this.parseExpressionUntil(new Set());
      } else if (this.matchWord("ROLE") || this.matchWord("ROLES")) {
        principal.roles.push(
          ...this.consumeNameListUntilWords("principal role list", FIELD_LIST_STOP_WORDS),
        );
        principal.match = "specific";
      } else if (this.matchWord("GROUP_ROLE") || this.matchWord("GROUP_ROLES")) {
        principal.groupRoles.push(
          ...this.consumeNameListUntilWords("principal group role list", FIELD_LIST_STOP_WORDS),
        );
        principal.match = "specific";
      } else if (this.matchWord("USER") || this.matchWord("USERS")) {
        principal.users.push(
          ...this.consumeNameListUntilWords("principal user list", FIELD_LIST_STOP_WORDS),
        );
        principal.match = "specific";
      } else if (this.matchWord("OWNER")) {
        principal.match = "owner";
        principal.owner = true;
      } else if (this.matchWord("EVERYONE")) {
        principal.match = "everyone";
      } else if (this.matchWord("AUTHENTICATED")) {
        principal.match = "authenticated";
      } else if (this.matchWord("ANONYMOUS")) {
        principal.match = "anonymous";
      } else if (this.matchWord("CONTEXT_MEMBER") || this.matchDottedWord("CONTEXT", "MEMBER")) {
        // `FIELD` is consumed here rather than left to the rule's own FIELD
        // option: it names the record field holding the co-member, not a field
        // the effect applies to.
        const context = this.consumeName("principal context member context name");
        this.expectWord("FIELD", "principal CONTEXT_MEMBER FIELD clause");
        const field = this.consumeName("principal context member field");
        principal.match = "contextMember";
        principal.contextMember = { context, field };
      } else {
        this.failUnexpected(
          "POLICY rule option FIELD, STATE, ACTION, CHANNELS, principal selector ROLE, GROUP_ROLE, USER, OWNER, EVERYONE, AUTHENTICATED, ANONYMOUS, CONTEXT_MEMBER, or end of line",
        );
      }
    }

    this.consumeLineEnd("POLICY rule");
    return {
      kind: "PolicyRuleDeclaration",
      name: name ?? `${effect}${pascalCase(action === "*" ? "all" : action)}${index + 1}`,
      effect,
      action,
      principal,
      state,
      fields,
      ...(lifecycleAction === undefined ? {} : { lifecycleAction }),
      ...(condition === undefined ? {} : { condition }),
      channels,
      range: this.rangeFrom(startToken),
    };
  }

  private parseTheme(): ThemeDeclarationAst {
    const startToken = this.expectWord("THEME", "THEME declaration");
    const name = this.consumeName("theme name");
    let base: string | undefined;
    const tokens: ThemeTokenDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("BASE")) {
        base = this.consumeName("base theme name");
      } else {
        this.failUnexpected("THEME header option BASE or end of line");
      }
    }
    this.consumeLineEnd("THEME declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.THEME", this.current());
      }

      if (this.checkEnd("THEME")) {
        const end = this.parseEnd("THEME");
        return {
          kind: "ThemeDeclaration",
          name,
          ...(base === undefined ? {} : { base }),
          tokens,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      tokens.push(this.parseThemeToken());
    }
  }

  private parseThemeToken(): ThemeTokenDeclarationAst {
    const startToken = this.current();
    let token: ThemeTokenName;

    if (this.matchWord("TOKEN")) {
      token = this.parseThemeTokenName(this.consumeName("theme token name"));
    } else {
      token = this.parseThemeTokenName(this.consumeWordLexeme("theme token name"));
    }

    const value = this.parseThemeTokenValue(token);
    this.consumeLineEnd("THEME token directive");
    return {
      kind: "ThemeTokenDeclaration",
      token,
      value,
      range: this.rangeFrom(startToken),
    };
  }

  private parseSync(objectScoped: boolean): SyncDeclarationAst {
    const startToken = this.expectWord("SYNC", "SYNC declaration");
    let object: string | undefined;

    if (!objectScoped) {
      object = this.consumeName("sync object name");
    }

    if (this.matchWord("MODE")) {
      // MODE is optional noise for readability.
    }
    const mode = normaliseSyncMode(this.consumeName("sync mode")) as SyncMode;
    let scope: SyncScope | undefined;
    let conflict: ConflictStrategy | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("SCOPE")) {
        scope = normaliseSyncScope(this.consumeName("sync scope")) as SyncScope;
      } else if (this.matchWord("CONFLICT")) {
        conflict = normaliseConflictStrategy(
          this.consumeName("sync conflict strategy"),
        ) as ConflictStrategy;
      } else {
        this.failUnexpected("SYNC option SCOPE, CONFLICT, or end of line");
      }
    }

    this.consumeLineEnd("SYNC declaration");
    return {
      kind: "SyncDeclaration",
      ...(object === undefined ? {} : { object }),
      mode,
      ...(scope === undefined ? {} : { scope }),
      ...(conflict === undefined ? {} : { conflict }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseDecisionTable(): DecisionTableDeclarationAst {
    const startToken = this.checkWord("DECISION_TABLE")
      ? this.expectWord("DECISION_TABLE", "DECISION_TABLE declaration")
      : this.expectDottedWord("DECISION", "TABLE", "DECISION.TABLE declaration");
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
    if (this.matchSymbol("=") || this.matchWord("FROM")) {
      // Both forms are accepted for readability.
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
    if (this.matchWord("WHEN")) {
      // WHEN is optional noise after the row name.
    }
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

  private parseCommand(): CommandDeclarationAst {
    const startToken = this.expectWord("COMMAND", "COMMAND declaration");
    const name = this.consumeName("command name");
    let label: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = this.consumeName("command label");
      } else {
        this.failUnexpected("COMMAND header option LABEL or end of line");
      }
    }
    this.consumeLineEnd("COMMAND declaration");

    const inputs: CommandInputDeclarationAst[] = [];
    const preconditions: CommandPreconditionDeclarationAst[] = [];
    const steps: CommandStepDeclarationAst[] = [];

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.COMMAND", this.current());
      }

      if (this.checkEnd("COMMAND")) {
        const end = this.parseEnd("COMMAND");
        return {
          kind: "CommandDeclaration",
          name,
          ...(label === undefined ? {} : { label }),
          inputs,
          preconditions,
          steps,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("INPUT")) {
        inputs.push(this.parseCommandInput());
      } else if (this.matchWord("REQUIRE")) {
        preconditions.push(
          this.parseCommandPreconditionFromCurrent(
            this.previous(),
            `${name}Requirement${preconditions.length + 1}`,
          ),
        );
      } else if (this.checkWord("STEP")) {
        steps.push(this.parseCommandStep());
      } else {
        this.failUnexpected("COMMAND directive INPUT, REQUIRE, STEP, or END.COMMAND");
      }
    }
  }

  /**
   * ```text
   * INPUT Ids LIST TEXT REQUIRED
   *
   * INPUT Songs LIST REQUIRED
   *   FIELD Title TEXT REQUIRED
   *   FIELD Composer TEXT
   * END.INPUT
   * ```
   *
   * `LIST` makes the input repeated. The item type follows it for a list of
   * scalars, or an `END.INPUT`-terminated block describes an item record. `LIST`
   * with neither carries plain text items.
   */
  private parseCommandInput(): CommandInputDeclarationAst {
    const startToken = this.expectWord("INPUT", "COMMAND INPUT directive");
    const name = this.consumeName("command input name");
    const repeated = this.matchWord("LIST");
    const type =
      repeated && (this.isLineEnd() || this.currentWordIsAny(COMMAND_INPUT_MODIFIER_WORDS))
        ? "text"
        : this.parseFieldType().type;
    let required = true;
    let defaultValue: JsonValue | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("REQUIRED")) {
        required = true;
      } else if (this.matchWord("OPTIONAL")) {
        required = false;
      } else if (this.matchWord("DEFAULT")) {
        defaultValue = this.consumeModifierValue("COMMAND INPUT DEFAULT value");
      } else {
        this.failUnexpected("COMMAND INPUT modifier REQUIRED, OPTIONAL, DEFAULT, or end of line");
      }
    }
    this.consumeLineEnd("COMMAND INPUT directive");

    const itemFields: CommandInputItemFieldDeclarationAst[] = [];
    let end: EndMarkerNode | undefined;

    // The block form is recognised by lookahead rather than a keyword on the
    // header line, so a scalar list stays a single line.
    if (repeated && this.checkWord("FIELD")) {
      while (end === undefined) {
        this.skipNewlines();

        if (this.isAtEnd()) {
          this.failExpected("END.INPUT", this.current());
        }

        if (this.checkEnd("INPUT")) {
          end = this.parseEnd("INPUT");
        } else if (this.checkWord("FIELD")) {
          itemFields.push(this.parseCommandInputItemField());
        } else {
          this.failUnexpected("COMMAND INPUT item directive FIELD or END.INPUT");
        }
      }
    }

    return {
      kind: "CommandInputDeclaration",
      name,
      type,
      required,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      repeated,
      itemFields,
      ...(end === undefined ? {} : { end }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseCommandInputItemField(): CommandInputItemFieldDeclarationAst {
    const startToken = this.expectWord("FIELD", "COMMAND INPUT item FIELD declaration");
    const name = this.consumeName("command input item field name");
    const { type } = this.parseFieldType();
    // Undeclared means optional, matching an object FIELD line of the same
    // shape rather than the containing INPUT's required-by-default header.
    let required = false;

    while (!this.isLineEnd()) {
      if (this.matchWord("REQUIRED")) {
        required = true;
      } else if (this.matchWord("OPTIONAL")) {
        required = false;
      } else {
        this.failUnexpected("COMMAND INPUT item FIELD modifier REQUIRED, OPTIONAL, or end of line");
      }
    }
    this.consumeLineEnd("COMMAND INPUT item FIELD declaration");

    return {
      kind: "CommandInputItemFieldDeclaration",
      name,
      type,
      required,
      range: this.rangeFrom(startToken),
    };
  }

  private parseCommandPreconditionFromCurrent(
    startToken: Token,
    name: string,
  ): CommandPreconditionDeclarationAst {
    const expression = this.parseExpressionUntil(new Set(["MESSAGE"]));
    let message: string | undefined;
    if (this.matchWord("MESSAGE")) {
      message = String(this.consumeLiteral("command requirement message"));
    }
    this.consumeLineEnd("COMMAND REQUIRE directive");
    return {
      kind: "CommandPreconditionDeclaration",
      name,
      expression,
      ...(message === undefined ? {} : { message }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseCommandStep(): CommandStepDeclarationAst {
    const startToken = this.expectWord("STEP", "COMMAND STEP declaration");
    const name = this.consumeName("command step name");
    const action = this.parseCommandStepAction();
    const object = this.consumeName("command step object name");
    let authority: CommandStepAuthority | undefined;
    let recordId: ResolvedCommandValueExpression | undefined;
    let forEach: string | undefined;
    let establishesContext: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("AUTHORITY")) {
        authority = this.parseCommandStepAuthority();
      } else if (this.matchWord("ID") || this.matchWord("RECORD")) {
        recordId = this.parseCommandValueExpression();
      } else if (this.matchWord("FOR_EACH")) {
        forEach = this.consumeName("command step FOR_EACH input name");
      } else if (this.matchWord("FOR")) {
        // `FOR EACH` as two words reads better in source; `FOR_EACH` is the
        // same clause spelled as one, like ACTIVE_WHEN and TOP_BAR elsewhere.
        this.expectWord("EACH", "command step FOR EACH clause");
        forEach = this.consumeName("command step FOR EACH input name");
      } else if (action === "create" && this.matchWord("ESTABLISHES")) {
        this.expectWord("CONTEXT", "command step ESTABLISHES CONTEXT clause");
        establishesContext = this.consumeName("command step established context name");
      } else {
        this.failUnexpected(
          action === "create"
            ? "COMMAND STEP header option AUTHORITY, ID, FOR EACH, ESTABLISHES CONTEXT, or end of line"
            : "COMMAND STEP header option AUTHORITY, ID, FOR EACH, or end of line",
        );
      }
    }
    this.consumeLineEnd("COMMAND STEP declaration");

    const values: Record<string, ResolvedCommandValueExpression> = {};
    const preconditions: ResolvedExpression[] = [];

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.STEP", this.current());
      }

      if (this.checkEnd("STEP")) {
        const end = this.parseEnd("STEP");
        return {
          kind: "CommandStepDeclaration",
          name,
          action,
          object,
          ...(authority === undefined ? {} : { authority }),
          ...(recordId === undefined ? {} : { recordId }),
          ...(forEach === undefined ? {} : { forEach }),
          ...(establishesContext === undefined ? {} : { establishesContext }),
          values,
          preconditions,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("VALUE") || this.matchWord("SET") || this.matchWord("PATCH")) {
        const field = this.consumeName("command step field name");
        if (this.matchSymbol("=")) {
          // Optional readability separator.
        }
        values[field] = this.parseCommandValueExpression();
        this.consumeLineEnd("COMMAND STEP value directive");
      } else if (this.matchWord("REQUIRE")) {
        preconditions.push(this.parseExpressionUntil(new Set()));
        this.consumeLineEnd("COMMAND STEP REQUIRE directive");
      } else {
        this.failUnexpected("COMMAND STEP directive VALUE, SET, PATCH, REQUIRE, or END.STEP");
      }
    }
  }

  private parseCommandStepAction(): "create" | "update" {
    const raw = normaliseKeyword(this.consumeName("command step action"));
    if (raw === "create") {
      return "create";
    }
    if (raw === "update") {
      return "update";
    }
    this.failExpected("command step action CREATE or UPDATE", this.previous());
  }

  private parseCommandStepAuthority(): CommandStepAuthority {
    const raw = normaliseKeyword(this.consumeName("command step authority"));
    if (raw === "caller") {
      return "caller";
    }
    if (raw === "command") {
      return "command";
    }
    this.failExpected("command step authority CALLER or COMMAND", this.previous());
  }

  private parseContextSelectionMode(): ContextSelectionMode {
    const token = this.consumeWordToken("context selection mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "required":
        return "required";
      case "optional":
        return "optional";
      default:
        this.failExpected("context selection mode REQUIRED or OPTIONAL", token);
    }
  }

  private parseContextSelectionPersistence(): ContextSelectionPersistence {
    const token = this.consumeWordToken("context selection persistence");

    switch (normaliseKeyword(token.lexeme)) {
      case "none":
        return "none";
      case "session":
        return "session";
      case "local":
        return "local";
      default:
        this.failExpected("context selection persistence NONE, SESSION, or LOCAL", token);
    }
  }

  private parseContextSelectionSource(): ContextSelectionSource {
    const token = this.consumeWordToken("context selection source");

    switch (normaliseKeyword(token.lexeme)) {
      case "runtime":
        return "runtime";
      case "route":
        return "route";
      default:
        this.failExpected("context selection source RUNTIME or ROUTE", token);
    }
  }

  private parseShellControlKind(): ShellControlKind {
    const token = this.consumeWordToken("shell control kind");

    switch (normaliseKeyword(token.lexeme)) {
      case "contextselector":
      case "context_selector":
        return "contextSelector";
      case "themeswitch":
      case "theme_switch":
        return "themeSwitch";
      case "logout":
        return "logout";
      case "pwainstall":
      case "pwa_install":
        return "pwaInstall";
      case "syncstatus":
      case "sync_status":
        return "syncStatus";
      case "connectivity":
        return "connectivity";
      default:
        this.failExpected(
          "shell control kind CONTEXT_SELECTOR, THEME_SWITCH, LOGOUT, PWA_INSTALL, SYNC_STATUS, or CONNECTIVITY",
          token,
        );
    }
  }

  private parseShellControlPlacement(): ShellControlPlacement {
    const token = this.consumeWordToken("shell control placement");

    switch (normaliseKeyword(token.lexeme)) {
      case "topbar":
      case "top_bar":
        return "topBar";
      case "navdrawer":
      case "nav_drawer":
        return "navDrawer";
      default:
        this.failExpected("shell control placement TOP_BAR or NAV_DRAWER", token);
    }
  }

  private parseShellContextSelectorPlacement(): ShellContextSelectorPlacement {
    const token = this.consumeWordToken("shell context selector placement");

    switch (normaliseKeyword(token.lexeme)) {
      case "topbar":
      case "top_bar":
        return "topBar";
      case "navdrawer":
      case "nav_drawer":
        return "navDrawer";
      case "hidden":
        return "hidden";
      default:
        this.failExpected("shell context selector placement TOP_BAR, NAV_DRAWER, or HIDDEN", token);
    }
  }

  private parseShellMobileContextSelectorMode(): ShellMobileContextSelectorMode {
    const token = this.consumeWordToken("shell mobile context selector mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "dropdown":
        return "dropdown";
      case "sheet":
        return "sheet";
      default:
        this.failExpected("shell mobile context selector mode DROPDOWN or SHEET", token);
    }
  }

  private parseCommandValueExpression(): ResolvedCommandValueExpression {
    if (this.matchWord("ITEM_INDEX")) {
      return { kind: "itemIndex" };
    }
    if (this.matchWord("ITEM")) {
      // A bare `ITEM` is the whole current item. A following word is one of its
      // fields unless it opens another step-header clause.
      if (this.isLineEnd() || this.currentWordIsAny(COMMAND_STEP_HEADER_WORDS)) {
        return { kind: "item" };
      }
      return { kind: "item", field: this.consumeName("command item field") };
    }
    if (this.matchWord("INPUT")) {
      return { kind: "input", name: this.consumeName("command input reference") };
    }
    if (this.matchWord("RUNTIME")) {
      return {
        kind: "runtime",
        property: this.consumeName("command runtime property") as CommandRuntimeProperty,
      };
    }
    if (this.matchWord("STEP")) {
      const step = this.consumeName("command step reference");
      if (this.matchWord("FIELD")) {
        return { kind: "stepField", step, field: this.consumeName("command step field") };
      }
      if (this.matchWord("META")) {
        return {
          kind: "stepMeta",
          step,
          property: this.consumeName("command step metadata property") as CommandStepMetaProperty,
        };
      }
      this.failExpected("FIELD or META after command STEP value expression", this.current());
    }
    if (this.matchWord("LITERAL")) {
      return { kind: "literal", value: this.consumeLiteral("command literal value") };
    }
    return { kind: "literal", value: this.consumeLiteral("command literal value") };
  }

  private consumeOutputMapUntilLine(context: string): Record<string, JsonValue> {
    const outputs: Record<string, JsonValue> = {};

    while (!this.isLineEnd()) {
      this.skipComma();
      if (this.isLineEnd()) {
        break;
      }
      const name = this.consumeName(`${context} name`);
      if (this.matchSymbol("=")) {
        // Optional readability separator.
      }
      outputs[name] = this.consumeLiteral(`${context} value`);
      this.skipComma();
    }

    if (Object.keys(outputs).length === 0) {
      this.failExpected(context, this.current());
    }

    return outputs;
  }

  private parseFieldType(): { type: FieldType; validators: ValidatorDeclarationAst[] } {
    const token = this.consumeWordToken("field type");
    const normalised = normaliseKeyword(token.lexeme);
    const validators: ValidatorDeclarationAst[] = [];
    let type: FieldType;

    switch (normalised) {
      case "text":
        type = "text";
        if (this.matchSymbol("(")) {
          const lengthToken = this.consumeNumber("TEXT length");
          this.expectSymbol(")", "TEXT length");
          validators.push(this.validator("maxLength", token, lengthToken));
        }
        break;
      case "num":
      case "number":
        type = "number";
        break;
      case "date":
        type = "date";
        break;
      case "datetime":
        type = "datetime";
        break;
      case "time":
        type = "time";
        break;
      case "bool":
      case "boolean":
        type = "boolean";
        break;
      case "attachment":
        type = "attachment";
        break;
      default:
        this.failExpected(
          "field type TEXT, NUMBER, DATE, DATETIME, TIME, BOOL, or ATTACHMENT",
          token,
        );
    }

    return { type, validators };
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

  private parsePresentationLayout(): PresentationLayout {
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

  private parsePresentationDensity(): PresentationDensity {
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

  private parsePresentationStateType(): PresentationStateType {
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

  private parsePresentationStatePersistence(): PresentationStatePersistence {
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

  private parsePresentationCalendarWeekStart(): PresentationCalendarWeekStart {
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

  private parsePresentationListRenderStyle(): PresentationListRenderStyle {
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

  private parsePresentationRowLayout(): PresentationRowLayout {
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

  private parsePresentationActionPlacement(): PresentationActionPlacement {
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

  private parsePresentationStatusThemeToken(): PresentationStatusThemeToken {
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

  private parsePresentationLegendInclude(): PresentationLegendInclude {
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

  private parsePresentationFragmentStyle(): PresentationFragmentStyle {
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

  private parsePresentationFormat(): { kind: PresentationFormatKind; pattern?: string } {
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
      default:
        return "text";
    }
  }

  private parsePresentationIconRef(
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

  private parsePolicyEffect(): PolicyEffect {
    const token = this.consumeWordToken("policy effect");

    switch (normaliseKeyword(token.lexeme)) {
      case "allow":
        return "allow";
      case "deny":
        return "deny";
      case "readonly":
        return "readonly";
      case "mask":
        return "mask";
      case "hidden":
        return "hidden";
      default:
        this.failExpected("policy effect ALLOW, DENY, READONLY, MASK, or HIDDEN", token);
    }
  }

  private parsePolicyAction(): PolicyAction {
    if (this.matchSymbol("*")) {
      return "*";
    }

    const token = this.consumeWordToken("policy action");

    switch (normaliseKeyword(token.lexeme)) {
      case "all":
        return "*";
      case "create":
        return "create";
      case "read":
        return "read";
      case "update":
        return "update";
      case "delete":
        return "delete";
      case "search":
        return "search";
      case "transition":
        return "transition";
      case "export":
        return "export";
      case "import":
        return "import";
      default:
        this.failExpected(
          "policy action CREATE, READ, UPDATE, DELETE, SEARCH, TRANSITION, EXPORT, IMPORT, or *",
          token,
        );
    }
  }

  private parseExpressionUntil(stopWords: Set<string>): ResolvedExpression {
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

  private parseThemeTokenName(raw: string): ThemeTokenName {
    switch (normaliseKeyword(raw)) {
      case "primary":
      case "colorprimary":
        return "colorPrimary";
      case "accent":
      case "coloraccent":
        return "colorAccent";
      case "background":
      case "colorbackground":
        return "colorBackground";
      case "surface":
      case "colorsurface":
        return "colorSurface";
      case "surfacealt":
      case "colorsurfacealt":
        return "colorSurfaceAlt";
      case "text":
      case "colortext":
        return "colorText";
      case "textmuted":
      case "colortextmuted":
        return "colorTextMuted";
      case "textinverted":
      case "colortextinverted":
        return "colorTextInverted";
      case "border":
      case "colorborder":
        return "colorBorder";
      case "danger":
      case "colordanger":
        return "colorDanger";
      case "success":
      case "colorsuccess":
        return "colorSuccess";
      case "info":
      case "colorinfo":
        return "colorInfo";
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
      case "radius":
        return "radius";
      case "density":
        return "density";
      case "nav":
      case "navigation":
        return "nav";
      case "font":
      case "fontfamily":
        return "fontFamily";
      case "logo":
      case "logourl":
        return "logoUrl";
      default:
        this.failExpected("known theme token name", this.previous());
    }
  }

  private parseThemeTokenValue(
    token: ThemeTokenName,
  ): string | ThemeRadius | ThemeDensity | ThemeNav {
    const value = String(this.consumeLiteral("theme token value"));

    switch (token) {
      case "radius":
        return normaliseThemeRadius(value);
      case "density":
        return normaliseThemeDensity(value);
      case "nav":
        return normaliseThemeNav(value);
      default:
        return value;
    }
  }

  private consumeStateListUntilTo(): string[] {
    if (this.matchSymbol("(")) {
      const states: string[] = [];

      while (!this.checkSymbol(")") && !this.isAtEnd()) {
        this.skipComma();
        if (this.checkSymbol(")")) {
          break;
        }
        states.push(this.consumeName("from-state name"));
        this.skipComma();
      }

      this.expectSymbol(")", "ACTION FROM state list");
      return states;
    }

    const states = this.consumeNameListUntilWords("from-state list", new Set(["TO"]));
    if (states.length === 0) {
      this.failExpected("at least one from-state before TO", this.current());
    }
    return states;
  }

  private consumeChannelsUntilWords(stopWords: Set<string>): RuntimeChannel[] {
    return this.consumeNameListUntilWords("runtime channel list", stopWords).map(
      (channel) => normaliseRuntimeChannel(channel) as RuntimeChannel,
    );
  }

  private consumeNameListUntilLine(context: string): string[] {
    return this.consumeNameListUntilWords(context, new Set());
  }

  private consumeNameListUntilWords(context: string, stopWords: Set<string>): string[] {
    const names: string[] = [];

    while (!this.isLineEnd()) {
      this.skipComma();

      if (this.isLineEnd() || this.currentWordIsAny(stopWords)) {
        break;
      }

      names.push(this.consumeName(context));
      this.skipComma();
    }

    if (names.length === 0) {
      this.failExpected(context, this.current());
    }

    return names;
  }

  private consumeQualifiedNameListUntilLine(context: string): string[] {
    const names: string[] = [];

    while (!this.isLineEnd()) {
      this.skipComma();

      if (this.isLineEnd()) {
        break;
      }

      names.push(this.consumeQualifiedName(context));
      this.skipComma();
    }

    if (names.length === 0) {
      this.failExpected(context, this.current());
    }

    return names;
  }

  private consumeQualifiedName(context: string): string {
    const first = this.consumeWordLexeme(context);
    const segments = [first];

    while (this.matchSymbol(".")) {
      segments.push(this.consumeWordLexeme(context));
    }

    return segments.join(".");
  }

  private consumeModifierValue(context: string): JsonValue {
    if (this.matchSymbol("(")) {
      const value = this.consumeLiteral(context);
      this.expectSymbol(")", context);
      return value;
    }

    return this.consumeLiteral(context);
  }

  private consumeIntegerModifierValue(context: string): number {
    const value = this.consumeModifierValue(context);

    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.failExpected("integer value", this.previous());
    }

    return value;
  }

  private consumeValueList(context: string): JsonValue[] {
    this.expectSymbol("(", context);
    const values: JsonValue[] = [];

    while (!this.checkSymbol(")") && !this.isAtEnd()) {
      this.skipComma();
      if (this.checkSymbol(")")) {
        break;
      }
      values.push(this.consumeLiteral(context));
      this.skipComma();
    }

    this.expectSymbol(")", context);
    return values;
  }

  private consumeLiteral(context: string): JsonValue {
    const token = this.current();

    if (token.kind === "string") {
      this.advance();
      return token.value as string;
    }

    if (token.kind === "number") {
      this.advance();
      return token.value as number;
    }

    if (token.kind === "boolean") {
      this.advance();
      return token.value as boolean;
    }

    if (this.matchWord("NULL")) {
      return null;
    }

    if (token.kind === "identifier") {
      this.advance();
      return token.lexeme;
    }

    this.failExpected(context, token);
  }

  private consumePrimitiveLiteral(context: string): JsonPrimitive {
    const value = this.consumeLiteral(context);

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    this.failExpected("primitive literal", this.previous());
  }

  private consumeName(context: string): string {
    const token = this.current();

    if (token.kind === "identifier" || token.kind === "string") {
      this.advance();
      return String(token.value ?? token.lexeme);
    }

    this.failExpected(context, token);
  }

  private consumeWordLexeme(context: string): string {
    return this.consumeWordToken(context).lexeme;
  }

  private consumeWordToken(context: string): Token {
    const token = this.current();

    if (token.kind === "identifier") {
      this.advance();
      return token;
    }

    this.failExpected(context, token);
  }

  private consumeNumber(context: string): number {
    const token = this.current();

    if (token.kind === "number" && typeof token.value === "number") {
      this.advance();
      return token.value;
    }

    this.failExpected(context, token);
  }

  private consumeBooleanValue(context: string): boolean {
    const token = this.current();

    if (token.kind === "boolean" && typeof token.value === "boolean") {
      this.advance();
      return token.value;
    }

    if (this.matchWord("TRUE")) {
      return true;
    }

    if (this.matchWord("FALSE")) {
      return false;
    }

    this.failExpected(context, token);
  }

  private validator(
    validatorKind: ValidatorKind,
    startToken: Token,
    value?: JsonValue,
  ): ValidatorDeclarationAst {
    return {
      kind: "ValidatorDeclaration",
      validatorKind,
      ...(value === undefined ? {} : { value }),
      range: { start: startToken.range.start, end: this.previous().range.end },
    };
  }

  private predicateValidator(
    startToken: Token,
    expression: ResolvedExpression,
    message: string | undefined,
  ): ValidatorDeclarationAst {
    return {
      kind: "ValidatorDeclaration",
      validatorKind: "predicate",
      expression,
      ...(message === undefined ? {} : { message }),
      range: { start: startToken.range.start, end: this.previous().range.end },
    };
  }

  private ensureAutoId(
    autoId: AutoIdDeclarationAst | undefined,
    startToken: Token,
  ): AutoIdDeclarationAst {
    return (
      autoId ?? {
        kind: "AutoIdDeclaration",
        range: startToken.range,
      }
    );
  }

  private parseEnd(name: BlockName): EndMarkerNode {
    const startToken = this.expectWord("END", `END.${name}`);
    this.expectSymbol(".", `END.${name}`);
    const nameToken = this.expectWord(name, `END.${name}`);
    const end: EndMarkerNode = {
      kind: "EndMarker",
      name,
      range: { start: startToken.range.start, end: nameToken.range.end },
    };
    this.consumeLineEnd(`END.${name}`);
    return end;
  }

  private checkEnd(name: BlockName): boolean {
    return (
      this.checkWord("END") &&
      this.peek(1).kind === "symbol" &&
      this.peek(1).lexeme === "." &&
      this.peek(2).kind === "identifier" &&
      this.peek(2).upper === name
    );
  }

  private expectWord(word: string, context: string): Token {
    const token = this.current();

    if (this.matchWord(word)) {
      return token;
    }

    this.failExpected(context, token);
  }

  private matchWord(word: string): boolean {
    if (!this.checkWord(word)) {
      return false;
    }

    this.advance();
    return true;
  }

  private checkWord(word: string): boolean {
    const token = this.current();
    return token.kind === "identifier" && token.upper === word;
  }

  private matchDottedWord(first: string, second: string): boolean {
    if (!this.checkDottedWord(first, second)) {
      return false;
    }

    this.advance();
    this.advance();
    this.advance();
    return true;
  }

  private expectDottedWord(first: string, second: string, context: string): Token {
    const token = this.current();
    if (this.matchDottedWord(first, second)) {
      return token;
    }
    this.failExpected(context, token);
  }

  private checkDottedWord(first: string, second: string): boolean {
    return (
      this.checkWord(first) &&
      this.peek(1).kind === "symbol" &&
      this.peek(1).lexeme === "." &&
      this.peek(2).kind === "identifier" &&
      this.peek(2).upper === second
    );
  }

  private expectSymbol(symbol: string, context: string): Token {
    const token = this.current();

    if (this.matchSymbol(symbol)) {
      return token;
    }

    this.failExpected(context, token);
  }

  private matchSymbol(symbol: string): boolean {
    if (!this.checkSymbol(symbol)) {
      return false;
    }

    this.advance();
    return true;
  }

  private checkSymbol(symbol: string): boolean {
    const token = this.current();
    return token.kind === "symbol" && token.lexeme === symbol;
  }

  private skipComma(): void {
    while (this.matchSymbol(",")) {
      // Consume separator.
    }
  }

  private skipNewlines(): void {
    while (this.current().kind === "newline") {
      this.advance();
    }
  }

  private consumeLineEnd(context: string): void {
    if (this.current().kind === "eof") {
      return;
    }

    if (this.current().kind !== "newline") {
      this.failExpected(`end of line after ${context}`, this.current());
    }

    this.skipNewlines();
  }

  private isLineEnd(): boolean {
    const token = this.current();
    return token.kind === "newline" || token.kind === "eof";
  }

  private currentWordIsAny(words: Set<string>): boolean {
    const token = this.current();
    return token.kind === "identifier" && words.has(token.upper ?? "");
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.currentIndex - 1)] ?? this.current();
  }

  private current(): Token {
    return this.tokens[this.currentIndex] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peek(distance: number): Token {
    return this.tokens[this.currentIndex + distance] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const token = this.current();
    if (!this.isAtEnd()) {
      this.currentIndex += 1;
    }
    return token;
  }

  private isAtEnd(): boolean {
    return this.current().kind === "eof";
  }

  private rangeFrom(startToken: Token): SourceRange {
    return {
      start: startToken.range.start,
      end: this.previous().range.end,
    };
  }

  private failExpected(expected: string, token: Token): never {
    this.fail(
      "ADL_PARSE_EXPECTED_TOKEN",
      `Expected ${expected}, but found ${describeToken(token)}.`,
      token,
    );
  }

  private failUnexpected(expected: string): never {
    this.failIfUnsupportedProceduralKeyword();
    this.fail(
      "ADL_PARSE_UNEXPECTED_TOKEN",
      `Expected ${expected}, but found ${describeToken(this.current())}.`,
      this.current(),
    );
  }

  private failIfUnsupportedProceduralKeyword(): void {
    const proceduralKeyword = this.currentProceduralKeyword();

    if (proceduralKeyword !== undefined) {
      this.fail(
        "ADL_PARSE_UNSUPPORTED_PROCEDURAL_KEYWORD",
        `Procedural keyword '${proceduralKeyword}' is not supported in declarative ADL.`,
        this.current(),
      );
    }
  }

  private currentProceduralKeyword(): string | undefined {
    const current = this.current();

    if (current.kind !== "identifier") {
      return undefined;
    }

    if (
      this.peek(1).kind === "symbol" &&
      this.peek(1).lexeme === "." &&
      this.peek(2).kind === "identifier"
    ) {
      const dotted = `${current.upper}.${this.peek(2).upper}`;
      if (PROCEDURAL_KEYWORDS.has(dotted)) {
        return dotted;
      }
    }

    return current.upper !== undefined && PROCEDURAL_KEYWORDS.has(current.upper)
      ? current.upper
      : undefined;
  }

  private fail(code: ParserDiagnostic["code"], message: string, token: Token): never {
    throw new ParseError({
      severity: "error",
      code,
      message,
      sourceRange: token.range,
    });
  }
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "end of file";
    case "newline":
      return "end of line";
    case "string":
      return `string ${token.lexeme}`;
    case "number":
    case "boolean":
    case "identifier":
    case "symbol":
      return `'${token.lexeme}'`;
  }
}

function normaliseKeyword(value: string): string {
  return value.replace(/[_\-.]/g, "").toLowerCase();
}

function normaliseSyncMode(value: string): string {
  switch (normaliseKeyword(value)) {
    case "localfirst":
      return "localFirst";
    case "cachereadonly":
      return "cacheReadonly";
    case "onlinerequired":
      return "onlineRequired";
    case "localprivate":
      return "localPrivate";
    default:
      return lowerCamel(value);
  }
}

function normaliseSyncScope(value: string): string {
  switch (normaliseKeyword(value)) {
    case "all":
      return "all";
    case "currentuser":
      return "currentUser";
    case "assignedtouser":
      return "assignedToUser";
    case "ownedbyuser":
      return "ownedByUser";
    case "currentcontext":
      return "currentContext";
    case "allavailablecontexts":
      return "allAvailableContexts";
    case "recent":
      return "recent";
    case "custom":
      return "custom";
    default:
      return lowerCamel(value);
  }
}

function normaliseConflictStrategy(value: string): string {
  switch (normaliseKeyword(value)) {
    case "serverwins":
      return "serverWins";
    case "clientwins":
      return "clientWins";
    case "statetransitionwins":
      return "stateTransitionWins";
    case "manual":
      return "manual";
    default:
      return lowerCamel(value);
  }
}

function normaliseRuntimeChannel(value: string): string {
  switch (normaliseKeyword(value)) {
    case "ui":
      return "ui";
    case "api":
      return "api";
    case "sync":
      return "sync";
    case "import":
      return "import";
    case "test":
      return "test";
    default:
      return lowerCamel(value);
  }
}

function normaliseThemeRadius(value: string): ThemeRadius {
  return lowerCamel(value) as ThemeRadius;
}

function normaliseThemeDensity(value: string): ThemeDensity {
  return lowerCamel(value) as ThemeDensity;
}

function normaliseThemeNav(value: string): ThemeNav {
  return lowerCamel(value) as ThemeNav;
}

function lowerCamel(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "";
  }

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

function pascalCase(value: string): string {
  const camel = lowerCamel(value);
  return camel.length === 0 ? "" : camel.charAt(0).toUpperCase() + camel.slice(1);
}
