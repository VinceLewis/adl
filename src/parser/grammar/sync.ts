import type {
  ConflictStrategy,
  ResolvedExpression,
  SyncMode,
  SyncScope,
} from "../../model/resolved-model.js";
import type { SyncDeclarationAst, SyncWindowDeclarationAst } from "../ast.js";
import { normaliseKeyword, lowerCamel } from "./text.js";
import { ThemeParser } from "./theme.js";

/**
 * `SYNC` declarations: mode, scope, window and conflict strategy.
 */
/**
 * `SYNC` options that may follow a `WHERE` predicate on the same line, so the
 * predicate expression stops rather than swallowing them.
 */
const SYNC_OPTION_WORDS = new Set(["SCOPE", "WINDOW", "CONFLICT"]);

/**
 * Words that cannot begin a `WINDOW` field name, so `WINDOW 14 DAYS` and
 * `WINDOW LIMIT 25` are not read as a field called `14` or `LIMIT`.
 */
const SYNC_WINDOW_NON_FIELD_WORDS = new Set([...SYNC_OPTION_WORDS, "WHERE", "LIMIT", "DAYS"]);

export class SyncParser extends ThemeParser {
  /**
   * ```text
   * SYNC LOCAL_FIRST SCOPE recent WINDOW Date 14 DAYS LIMIT 50
   * SYNC LOCAL_FIRST SCOPE custom WHERE Status == 'open' AND Owner == RUNTIME.userId
   * ```
   *
   * `WINDOW` and `WHERE` are the two clauses that let an author say what a
   * device keeps offline. Before them the resolved model could carry a window
   * and the runtime could honour one, but no `.adl` file could declare either,
   * so `SCOPE recent` meant a hard-coded 30 days over `_updatedAt` and
   * `SCOPE custom` meant nothing at all.
   */
  protected parseSync(objectScoped: boolean): SyncDeclarationAst {
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
    let window: SyncWindowDeclarationAst | undefined;
    let predicate: ResolvedExpression | undefined;
    let conflict: ConflictStrategy | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("SCOPE")) {
        scope = normaliseSyncScope(this.consumeName("sync scope")) as SyncScope;
      } else if (this.checkWord("WINDOW")) {
        window = this.parseSyncWindow();
      } else if (this.matchWord("WHERE")) {
        // Stopping at the remaining SYNC options keeps the predicate from
        // swallowing a `CONFLICT` that follows it on the same line.
        predicate = this.parseExpressionUntil(SYNC_OPTION_WORDS);
      } else if (this.matchWord("CONFLICT")) {
        conflict = normaliseConflictStrategy(
          this.consumeName("sync conflict strategy"),
        ) as ConflictStrategy;
      } else {
        this.failUnexpected("SYNC option SCOPE, WINDOW, WHERE, CONFLICT, or end of line");
      }
    }

    this.consumeLineEnd("SYNC declaration");
    return {
      kind: "SyncDeclaration",
      ...(object === undefined ? {} : { object }),
      mode,
      ...(scope === undefined ? {} : { scope }),
      ...(window === undefined ? {} : { window }),
      ...(predicate === undefined ? {} : { predicate }),
      ...(conflict === undefined ? {} : { conflict }),
      range: this.rangeFrom(startToken),
    };
  }

  /**
   * ```text
   * WINDOW Date 14 DAYS LIMIT 50
   * WINDOW _updatedAt 90 DAYS
   * WINDOW Date LIMIT 25
   * ```
   *
   * Each part is optional but the order is fixed, and the unit word after the
   * day count is required. That follows `OFFLINE_GRACE <days> DAYS`: a bare
   * number can never be read as the wrong unit if a second unit is ever added.
   */
  private parseSyncWindow(): SyncWindowDeclarationAst {
    const startToken = this.expectWord("WINDOW", "SYNC WINDOW clause");
    let field: string | undefined;
    let days: number | undefined;
    let limit: number | undefined;

    if (this.currentIsSyncWindowFieldName()) {
      field = this.consumeName("SYNC WINDOW field name");
    }

    if (this.current().kind === "number") {
      days = this.consumeNumber("SYNC WINDOW day count");
      this.expectWord("DAYS", "SYNC WINDOW unit");
    }

    if (this.matchWord("LIMIT")) {
      limit = this.consumeNumber("SYNC WINDOW record limit");
    }

    if (field === undefined && days === undefined && limit === undefined) {
      this.failUnexpected("SYNC WINDOW field name, day count followed by DAYS, or LIMIT");
    }

    return {
      kind: "SyncWindowDeclaration",
      ...(field === undefined ? {} : { field }),
      ...(days === undefined ? {} : { days }),
      ...(limit === undefined ? {} : { limit }),
      range: this.rangeFrom(startToken),
    };
  }

  private currentIsSyncWindowFieldName(): boolean {
    const token = this.current();

    if (token.kind === "string") {
      return true;
    }

    return token.kind === "identifier" && !SYNC_WINDOW_NON_FIELD_WORDS.has(token.upper ?? "");
  }
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
