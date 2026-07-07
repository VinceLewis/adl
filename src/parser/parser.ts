import type {
  ConflictStrategy,
  FieldType,
  JsonValue,
  PolicyAction,
  PolicyEffect,
  RuntimeChannel,
  SyncMode,
  SyncScope,
  ThemeDensity,
  ThemeNav,
  ThemeRadius,
  ValidatorKind,
  ViewKind,
} from "../model/resolved-model.js";
import type {
  ActionAllowDeclarationAst,
  ActionDeclarationAst,
  AdlDocumentAst,
  AppDeclarationAst,
  AutoIdDeclarationAst,
  BlockName,
  EndMarkerNode,
  FieldDeclarationAst,
  HookRefsAst,
  LifecycleDeclarationAst,
  LookupDeclarationAst,
  ObjectDeclarationAst,
  PolicyDeclarationAst,
  PolicyRuleDeclarationAst,
  PrincipalSelectorAst,
  RoleDeclarationAst,
  SortDeclarationAst,
  SourcePosition,
  SourceRange,
  StateDeclarationAst,
  SyncDeclarationAst,
  ThemeDeclarationAst,
  ThemeTokenDeclarationAst,
  ThemeTokenName,
  ValidatorDeclarationAst,
  ViewDeclarationAst,
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
  "STATE",
  "ACTION",
  "CHANNEL",
  "CHANNELS",
]);

class AdlParser {
  private currentIndex = 0;

  constructor(private readonly tokens: Token[]) {}

  parseDocument(): AdlDocumentAst {
    this.skipNewlines();
    const start = this.current().range.start;
    const app = this.parseApp();
    const roles: RoleDeclarationAst[] = [];
    const objects: ObjectDeclarationAst[] = [];
    const policies: PolicyDeclarationAst[] = [];
    const themes: ThemeDeclarationAst[] = [];
    const sync: SyncDeclarationAst[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        break;
      }

      if (this.checkWord("ROLE")) {
        roles.push(this.parseRole());
      } else if (this.checkWord("OBJECT")) {
        objects.push(this.parseObject());
      } else if (this.checkWord("POLICY")) {
        policies.push(this.parsePolicy());
      } else if (this.checkWord("THEME")) {
        themes.push(this.parseTheme());
      } else if (this.checkWord("SYNC")) {
        sync.push(this.parseSync(false));
      } else {
        this.failUnexpected("a top-level ROLE, OBJECT, POLICY, THEME, SYNC, or end of file");
      }
    }

    return {
      kind: "AdlDocument",
      app,
      roles,
      objects,
      policies,
      themes,
      sync,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseApp(): AppDeclarationAst {
    const startToken = this.expectWord("APP", "APP declaration");
    const name = this.consumeName("application name");
    let theme: string | undefined;
    let startView: string | undefined;
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
      } else {
        this.failUnexpected("APP directive THEME, START_VIEW, or END.APP");
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

  private parseObject(): ObjectDeclarationAst {
    const startToken = this.expectWord("OBJECT", "OBJECT declaration");
    const name = this.consumeName("object name");
    let businessKey: string | undefined;
    let displayField: string | undefined;
    let lifecycle: LifecycleDeclarationAst | undefined;
    let sync: SyncDeclarationAst | undefined;
    const fields: FieldDeclarationAst[] = [];
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
          fields,
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
      } else if (this.checkWord("FIELD")) {
        fields.push(this.parseField());
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
          "OBJECT directive KEY, DISPLAY, FIELD, LIFECYCLE, VIEW, SYNC, POLICY, or END.OBJECT",
        );
      }
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
    const hooks: HookRefsAst = { before: [], after: [], onError: [] };

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = this.consumeName("action label");
      } else if (this.matchWord("POLICY") || this.matchWord("POLICIES")) {
        policyRefs.push(...this.consumeNameListUntilLine("action policy reference list"));
      } else {
        this.failUnexpected("ACTION header option LABEL, POLICY, or end of line");
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
          policyRefs,
          allowRules,
          hooks,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("ALLOW")) {
        allowRules.push(this.parseActionAllow());
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
          "ACTION directive ALLOW, POLICY, BEFORE, AFTER, ON_ERROR, or END.ACTION",
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

  private parseView(): ViewDeclarationAst {
    const startToken = this.expectWord("VIEW", "VIEW declaration");
    const name = this.consumeName("view name");
    const viewKind = this.parseViewKind();
    const fields: string[] = [];
    const searchFields: string[] = [];
    const sort: SortDeclarationAst[] = [];
    const actions: string[] = [];
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
          fields,
          searchFields,
          sort,
          actions,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("FIELDS")) {
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
      } else {
        this.failUnexpected("VIEW directive FIELDS, SEARCH, ACTIONS, SORT, or END.VIEW");
      }
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

    while (!this.isLineEnd()) {
      if (this.matchWord("FIELD") || this.matchWord("FIELDS")) {
        fields.push(...this.consumeNameListUntilWords("policy field list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("STATE")) {
        state.push(...this.consumeNameListUntilWords("policy state list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("ACTION")) {
        lifecycleAction = this.consumeName("policy lifecycle action");
      } else if (this.matchWord("CHANNEL") || this.matchWord("CHANNELS")) {
        channels.push(...this.consumeChannelsUntilWords(FIELD_LIST_STOP_WORDS));
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
      } else {
        this.failUnexpected(
          "POLICY rule option FIELD, STATE, ACTION, CHANNELS, principal selector, or end of line",
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
    if (
      !this.checkWord(first) ||
      this.peek(1).kind !== "symbol" ||
      this.peek(1).lexeme !== "." ||
      this.peek(2).kind !== "identifier" ||
      this.peek(2).upper !== second
    ) {
      return false;
    }

    this.advance();
    this.advance();
    this.advance();
    return true;
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
    case "assignedtouser":
      return "assignedToUser";
    case "ownedbyuser":
      return "ownedByUser";
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
