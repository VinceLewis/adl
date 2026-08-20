import type { FieldType, ReadModelJoinCardinality } from "../../model/resolved-model.js";
import type {
  ReadModelDeclarationAst,
  ReadModelFieldDeclarationAst,
  ReadModelSourceDeclarationAst,
  ReadModelSourceJoinDeclarationAst,
  SortDeclarationAst,
  ViewContextDeclarationAst,
} from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { ObjectFieldParser } from "./object-field.js";

/**
 * `READ_MODEL` declarations, sources, joins and fields.
 */
/**
 * Words that end the `SOURCE <name> [<object>]` shorthand. Without these an
 * option keyword immediately after the source name would be read as the object.
 */
const READ_MODEL_SOURCE_OPTION_WORDS = new Set(["SCOPE", "AS", "JOIN", "CARDINALITY"]);

export class ReadModelParser extends ObjectFieldParser {
  protected parseReadModel(): ReadModelDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectUnderscoreOrDottedWord(
      "top-level READ_MODEL block",
      "READ_MODEL",
      "READ",
      "MODEL",
      "READ_MODEL declaration",
    );
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
          ...(leadingComment === undefined ? {} : { leadingComment }),
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
    const leadingComment = this.takeLeadingComment();
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
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
    const leadingComment = this.takeLeadingComment();
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
        ...(leadingComment === undefined ? {} : { leadingComment }),
        range: this.rangeFrom(startToken),
      };
    }

    const binderToken = this.current();
    if (this.matchSymbol("=")) {
      // Canonical form.
    } else if (this.matchWord("AS")) {
      this.recordDeprecatedSpelling("READ_MODEL FIELD binder", "AS", "=", binderToken);
    } else {
      this.failExpected("FROM, =, or AS in READ_MODEL FIELD declaration", this.current());
    }
    const expression = this.parseExpressionUntil(new Set());
    this.consumeLineEnd("READ_MODEL FIELD declaration");
    return {
      kind: "ReadModelFieldDeclaration",
      name,
      ...(type === undefined ? {} : { type }),
      expression,
      ...(leadingComment === undefined ? {} : { leadingComment }),
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
}
