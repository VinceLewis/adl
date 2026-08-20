import type {
  ActionAllowDeclarationAst,
  ActionDeclarationAst,
  HookRefsAst,
  LifecycleGuardDeclarationAst,
  LifecycleDeclarationAst,
  StateDeclarationAst,
} from "../ast.js";
import type { Token } from "../lexer.js";
import { DecisionTableParser } from "./decision-table.js";

/**
 * `LIFECYCLE` declarations: states, actions, inline allows and guards.
 */
export class LifecycleParser extends DecisionTableParser {
  protected parseLifecycle(): LifecycleDeclarationAst {
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
      } else if (
        this.matchCanonicalOrDeprecatedWord("ACTION POLICY reference list", "POLICY", "POLICIES")
      ) {
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
      } else if (
        this.matchCanonicalOrDeprecatedWord("ACTION POLICY reference list", "POLICY", "POLICIES")
      ) {
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
      if (this.matchCanonicalOrDeprecatedWord("ACTION ALLOW ROLE list", "ROLE", "ROLES")) {
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
}
