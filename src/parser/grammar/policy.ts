import type {
  PolicyAction,
  PolicyEffect,
  ResolvedExpression,
  RuntimeChannel,
} from "../../model/resolved-model.js";
import type {
  PolicyDeclarationAst,
  PolicyRuleDeclarationAst,
  PrincipalSelectorAst,
} from "../ast.js";
import { normaliseKeyword, pascalCase } from "./text.js";
import { SyncParser } from "./sync.js";

/**
 * `POLICY` declarations, rules and principal selectors.
 */
/**
 * A policy rule's clauses may appear in any order, so every clause list stops
 * at the keyword that begins another clause. `FIELDS`/`FIELD` belonged in this
 * set from the start and was missing: a rule written or printed as `READONLY
 * UPDATE ROLE Requester STATE Draft FIELDS InternalNotes` had its `STATE` list
 * swallow `FIELDS` and `InternalNotes` as two further state names, and failed
 * resolution with `ADL_POLICY_STATE_UNKNOWN` against states that were never
 * written. Only the `FIELDS`-first spelling worked, which is why no hand-authored
 * source ever hit it — `print-adl.ts` emits `FIELDS` last, so the defect was
 * reachable only by round-tripping a rule that carries both clauses (Phase 98).
 */
const FIELD_LIST_STOP_WORDS = new Set([
  "FIELDS",
  "FIELD",
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

export class PolicyParser extends SyncParser {
  protected parsePolicy(): PolicyDeclarationAst {
    const leadingComment = this.takeLeadingComment();
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
          ...(leadingComment === undefined ? {} : { leadingComment }),
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
    const leadingComment = this.takeLeadingComment();
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
      if (this.matchCanonicalOrDeprecatedWord("POLICY rule FIELDS list", "FIELDS", "FIELD")) {
        fields.push(...this.consumeNameListUntilWords("policy field list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("STATE")) {
        state.push(...this.consumeNameListUntilWords("policy state list", FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("ACTION")) {
        lifecycleAction = this.consumeName("policy lifecycle action");
      } else if (
        this.matchCanonicalOrDeprecatedWord("POLICY rule CHANNELS list", "CHANNELS", "CHANNEL")
      ) {
        channels.push(...this.consumeChannelsUntilWords(FIELD_LIST_STOP_WORDS));
      } else if (this.matchWord("WHEN")) {
        condition = this.parseExpressionUntil(new Set());
      } else if (
        this.matchCanonicalOrDeprecatedWord("POLICY principal ROLE list", "ROLE", "ROLES")
      ) {
        principal.roles.push(
          ...this.consumeNameListUntilWords("principal role list", FIELD_LIST_STOP_WORDS),
        );
        principal.match = "specific";
      } else if (
        this.matchCanonicalOrDeprecatedWord(
          "POLICY principal GROUP_ROLE list",
          "GROUP_ROLE",
          "GROUP_ROLES",
        )
      ) {
        principal.groupRoles.push(
          ...this.consumeNameListUntilWords("principal group role list", FIELD_LIST_STOP_WORDS),
        );
        principal.match = "specific";
      } else if (
        this.matchCanonicalOrDeprecatedWord("POLICY principal USER list", "USER", "USERS")
      ) {
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
      } else if (
        this.matchUnderscoreOrDottedWord(
          "POLICY principal CONTEXT_MEMBER",
          "CONTEXT_MEMBER",
          "CONTEXT",
          "MEMBER",
        )
      ) {
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
      range: this.rangeFrom(startToken),
    };
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
}
