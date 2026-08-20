import type {
  JsonValue,
  CommandRuntimeProperty,
  CommandStepAuthority,
  CommandStepMetaProperty,
  ResolvedCommandValueExpression,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type {
  CommandDeclarationAst,
  CommandInputDeclarationAst,
  CommandInputItemFieldDeclarationAst,
  CommandPreconditionDeclarationAst,
  CommandStepDeclarationAst,
  EndMarkerNode,
} from "../ast.js";
import type { Token } from "../lexer.js";
import { normaliseKeyword } from "./text.js";
import { ReadModelParser } from "./read-model.js";

/**
 * `COMMAND` declarations: inputs, preconditions and steps.
 */
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

export class CommandParser extends ReadModelParser {
  protected parseCommand(): CommandDeclarationAst {
    const leadingComment = this.takeLeadingComment();
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
          ...(leadingComment === undefined ? {} : { leadingComment }),
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

  /**
   * `VALUE`/`SET`/`PATCH` is a three-way alias, not a pair: `VALUE` is
   * canonical (23 real uses in Giggle Band's domain source against zero for
   * `SET` and one for `PATCH`, itself only in a test proving the alias still
   * parses; counted at Phase 72, against the `.adl` text that has since been
   * superseded by `src/reference/giggle-band/domain.adlj`).
   */
  private matchCommandStepValueDirective(): boolean {
    const token = this.current();
    if (this.matchWord("VALUE")) {
      return true;
    }
    if (this.matchWord("SET")) {
      this.recordDeprecatedSpelling("COMMAND STEP value directive", "SET", "VALUE", token);
      return true;
    }
    if (this.matchWord("PATCH")) {
      this.recordDeprecatedSpelling("COMMAND STEP value directive", "PATCH", "VALUE", token);
      return true;
    }
    return false;
  }

  private parseCommandStep(): CommandStepDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("STEP", "COMMAND STEP declaration");
    const name = this.consumeName("command step name");
    const action = this.parseCommandStepAction();
    const object = this.consumeName("command step object name");
    let authority: CommandStepAuthority | undefined;
    let recordId: ResolvedCommandValueExpression | undefined;
    let forEach: string | undefined;
    let establishesContext: string | undefined;

    while (!this.isLineEnd()) {
      if (action !== "read" && this.matchWord("AUTHORITY")) {
        authority = this.parseCommandStepAuthority();
      } else if (
        this.matchCanonicalOrDeprecatedWord("COMMAND STEP record identity", "ID", "RECORD")
      ) {
        recordId = this.parseCommandValueExpression();
      } else if (action !== "read" && this.checkWord("FOR_EACH")) {
        // `FOR EACH` as two words is canonical (Phase 72; it is what
        // Giggle Band's domain source uses) — `FOR_EACH` spelled as one word, like
        // ACTIVE_WHEN and TOP_BAR elsewhere, still parses but is deprecated.
        const token = this.current();
        this.matchWord("FOR_EACH");
        this.recordDeprecatedSpelling(
          "COMMAND STEP FOR EACH clause",
          "FOR_EACH",
          "FOR EACH",
          token,
        );
        forEach = this.consumeName("command step FOR EACH input name");
      } else if (action !== "read" && this.matchWord("FOR")) {
        this.expectWord("EACH", "command step FOR EACH clause");
        forEach = this.consumeName("command step FOR EACH input name");
      } else if (action === "create" && this.matchWord("ESTABLISHES")) {
        this.expectWord("CONTEXT", "command step ESTABLISHES CONTEXT clause");
        establishesContext = this.consumeName("command step established context name");
      } else {
        this.failUnexpected(
          action === "create"
            ? "COMMAND STEP header option AUTHORITY, ID, FOR EACH, ESTABLISHES CONTEXT, or end of line"
            : action === "read"
              ? "COMMAND STEP header option ID or end of line"
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
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      // A read step writes nothing, so it has no VALUE/SET/PATCH directive —
      // only REQUIRE, evaluated against the record it read, and END.STEP.
      if (action !== "read" && this.matchCommandStepValueDirective()) {
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
        this.failUnexpected(
          action === "read"
            ? "COMMAND STEP directive REQUIRE or END.STEP"
            : "COMMAND STEP directive VALUE, SET, PATCH, REQUIRE, or END.STEP",
        );
      }
    }
  }

  private parseCommandStepAction(): "create" | "update" | "read" {
    const raw = normaliseKeyword(this.consumeName("command step action"));
    if (raw === "create") {
      return "create";
    }
    if (raw === "update") {
      return "update";
    }
    if (raw === "read") {
      return "read";
    }
    this.failExpected("command step action CREATE, UPDATE, or READ", this.previous());
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
}
