import type {
  ContextSelectionMode,
  ContextSelectionPersistence,
  ContextSelectionSource,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type { BusinessContextDeclarationAst, ContextGrantDeclarationAst } from "../ast.js";
import type { Token } from "../lexer.js";
import { normaliseKeyword } from "./text.js";
import { CommandParser } from "./command.js";

/**
 * `CONTEXT` declarations, membership and `CONTEXT_GRANT`.
 */
export class ContextParser extends CommandParser {
  /**
   * The `ON <Context>` token of every parsed `CONTEXT_GRANT`, kept so the
   * end-of-document check can point at the name rather than the whole line.
   */
  private readonly contextGrantTargets: { context: string; token: Token }[] = [];

  protected parseBusinessContext(): BusinessContextDeclarationAst {
    const leadingComment = this.takeLeadingComment();
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
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
      } else if (
        this.matchCanonicalOrDeprecatedWord(
          "CONTEXT MEMBERSHIP CONTEXT_FIELD",
          "CONTEXT_FIELD",
          "CONTEXT",
        )
      ) {
        contextField = this.consumeName("context membership context field");
      } else if (
        this.matchCanonicalOrDeprecatedWord("CONTEXT MEMBERSHIP ROLE_FIELD", "ROLE_FIELD", "ROLE")
      ) {
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
  protected parseContextGrant(): ContextGrantDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectUnderscoreOrDottedWord(
      "top-level CONTEXT_GRANT block",
      "CONTEXT_GRANT",
      "CONTEXT",
      "GRANT",
      "CONTEXT_GRANT declaration",
    );
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
      } else if (
        this.matchCanonicalOrDeprecatedWord(
          "CONTEXT_GRANT CONTEXT_FIELD",
          "CONTEXT_FIELD",
          "CONTEXT",
        )
      ) {
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
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
  protected requireDeclaredContextsForGrants(
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
}
