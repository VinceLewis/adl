import type {
  FieldType,
  JsonValue,
  OrderedCollectionCompaction,
  OrderedCollectionReorder,
  ResolvedExpression,
  ValidatorKind,
} from "../../model/resolved-model.js";
import type {
  AutoIdDeclarationAst,
  ComputedFieldDeclarationAst,
  FieldDeclarationAst,
  LifecycleDeclarationAst,
  LookupDeclarationAst,
  ObjectConstraintDeclarationAst,
  ObjectValidationDeclarationAst,
  ObjectDeclarationAst,
  ObjectScopeDeclarationAst,
  SyncDeclarationAst,
  ValidatorDeclarationAst,
  ViewDeclarationAst,
} from "../ast.js";
import type { Token } from "../lexer.js";
import { normaliseKeyword } from "./text.js";
import { ViewParser } from "./view.js";

/**
 * `OBJECT` declarations: scope, constraints, fields, validators, computed
 * fields, lookups and auto ids.
 */
export class ObjectFieldParser extends ViewParser {
  protected parseObject(): ObjectDeclarationAst {
    const leadingComment = this.takeLeadingComment();
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
          ...(leadingComment === undefined ? {} : { leadingComment }),
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
      } else if (
        this.matchUnderscoreOrDottedWord(
          "OBJECT SCHEMA_VERSION",
          "SCHEMA_VERSION",
          "SCHEMA",
          "VERSION",
        )
      ) {
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
    const binderToken = this.current();
    if (this.matchSymbol("=")) {
      // Canonical form.
    } else if (this.matchWord("AS")) {
      this.recordDeprecatedSpelling("COMPUTED field binder", "AS", "=", binderToken);
    } else {
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
    const leadingComment = this.takeLeadingComment();
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
        } else if (
          this.matchCanonicalOrDeprecatedWord("CONSTRAINT UNIQUE FIELDS list", "FIELDS", "FIELD")
        ) {
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
        ...(leadingComment === undefined ? {} : { leadingComment }),
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
        ...(leadingComment === undefined ? {} : { leadingComment }),
        range: this.rangeFrom(startToken),
      };
    }

    if (constraintKind === "protectedrole") {
      let scopeFields: string[] = [];
      let roleField: string | undefined;
      let roleValues: JsonValue[] = [];
      let minCount: number | undefined;

      while (!this.isLineEnd()) {
        if (this.matchWord("SCOPE")) {
          scopeFields = this.consumeNameListUntilWords(
            "protected role constraint scope fields",
            new Set(["FIELD", "VALUES", "MIN"]),
          );
        } else if (this.matchWord("FIELD")) {
          roleField = this.consumeName("protected role constraint field");
        } else if (this.matchWord("VALUES")) {
          roleValues = this.consumeValueList("PROTECTED_ROLE CONSTRAINT VALUES");
        } else if (this.matchWord("MIN")) {
          minCount = this.consumeIntegerModifierValue("protected role constraint minimum count");
        } else {
          this.failUnexpected(
            "PROTECTED_ROLE CONSTRAINT option SCOPE, FIELD, VALUES, MIN, or end of line",
          );
        }
      }

      if (roleField === undefined) {
        this.failExpected("FIELD in PROTECTED_ROLE constraint", this.previous());
      }
      if (roleValues.length === 0) {
        this.failExpected("VALUES in PROTECTED_ROLE constraint", this.previous());
      }

      this.consumeLineEnd("OBJECT CONSTRAINT declaration");
      return {
        kind: "ProtectedRoleObjectConstraintDeclaration",
        name,
        scopeFields,
        roleField,
        roleValues,
        ...(minCount === undefined ? {} : { minCount }),
        ...(leadingComment === undefined ? {} : { leadingComment }),
        range: this.rangeFrom(startToken),
      };
    }

    this.failExpected("object constraint kind UNIQUE, ORDERED, or PROTECTED_ROLE", this.previous());
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
    const leadingComment = this.takeLeadingComment();
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
          this.validator("mimeType", this.previous(), this.consumeValueList("MIME_TYPE values")),
        );
      } else if (this.matchCanonicalOrDeprecatedWord("FIELD validator", "VALIDATE", "PREDICATE")) {
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
      } else if (this.matchUnderscoreOrDottedWord("FIELD AUTO_ID", "AUTO_ID", "AUTO", "ID")) {
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseObjectValidation(): ObjectValidationDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.current();
    if (!this.matchCanonicalOrDeprecatedWord("OBJECT VALIDATE block", "VALIDATE", "VALIDATION")) {
      this.expectWord("VALIDATION", "object validation declaration");
    }
    const name = this.consumeName("object validation name");
    // Unlike DECISION_TABLE ROW's WHEN (required, Phase 72), this WHEN stays
    // optional noise: real content (Giggle Band's
    // `respondedAtRequiredAfterResponse`) omits it, so requiring it here would
    // break existing content rather than only teach one spelling.
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
      ...(leadingComment === undefined ? {} : { leadingComment }),
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

  protected parseFieldType(): { type: FieldType; validators: ValidatorDeclarationAst[] } {
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
}
