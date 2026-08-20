import type { JsonValue, JsonPrimitive, RuntimeChannel } from "../../model/resolved-model.js";
import type { Token } from "../lexer.js";
import { normaliseKeyword, lowerCamel } from "./text.js";
import { CursorParser } from "./cursor.js";

/**
 * Value readers: names, qualified names, name/value lists, literals, numbers,
 * booleans, channel lists and output maps.
 */
export class LiteralParser extends CursorParser {
  protected consumeOutputMapUntilLine(context: string): Record<string, JsonValue> {
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

  // Parenthesized is mandatory (Phase 72), matching `IN`/`MIME_TYPE`'s
  // established list-value shape: a bare space-separated list is a parse
  // error now, not a style warning.
  protected consumeStateListUntilTo(): string[] {
    this.expectSymbol("(", "ACTION FROM state list");
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
    if (states.length === 0) {
      this.failExpected("at least one from-state before TO", this.current());
    }
    return states;
  }

  protected consumeChannelsUntilWords(stopWords: Set<string>): RuntimeChannel[] {
    return this.consumeNameListUntilWords("runtime channel list", stopWords).map(
      (channel) => normaliseRuntimeChannel(channel) as RuntimeChannel,
    );
  }

  protected consumeNameListUntilLine(context: string): string[] {
    return this.consumeNameListUntilWords(context, new Set());
  }

  protected consumeNameListUntilWords(context: string, stopWords: Set<string>): string[] {
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

  protected consumeQualifiedNameListUntilLine(context: string): string[] {
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

  protected consumeQualifiedName(context: string): string {
    const first = this.consumeWordLexeme(context);
    const segments = [first];

    while (this.matchSymbol(".")) {
      segments.push(this.consumeWordLexeme(context));
    }

    return segments.join(".");
  }

  // Parentheses are mandatory (Phase 72): `MIN(0)`, `MAX(150)`, `DEFAULT(0)`
  // and every other modifier value join `IN(...)`/`MIME_TYPE(...)` (always
  // parenthesized, via `consumeValueList`) as the only legal forms. A bare
  // value is a genuine parse error, not a style warning — unlike a keyword
  // alias, there is no way to keep accepting it without the two shapes
  // staying two facts to remember forever.
  protected consumeModifierValue(context: string): JsonValue {
    this.expectSymbol("(", context);
    const value = this.consumeLiteral(context);
    this.expectSymbol(")", context);
    return value;
  }

  protected consumeIntegerModifierValue(context: string): number {
    const value = this.consumeModifierValue(context);

    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.failExpected("integer value", this.previous());
    }

    return value;
  }

  protected consumeValueList(context: string): JsonValue[] {
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

  protected consumeLiteral(context: string): JsonValue {
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

  protected consumePrimitiveLiteral(context: string): JsonPrimitive {
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

  protected consumeName(context: string): string {
    const token = this.current();

    if (token.kind === "identifier" || token.kind === "string") {
      this.advance();
      return String(token.value ?? token.lexeme);
    }

    this.failExpected(context, token);
  }

  protected consumeWordLexeme(context: string): string {
    return this.consumeWordToken(context).lexeme;
  }

  protected consumeWordToken(context: string): Token {
    const token = this.current();

    if (token.kind === "identifier") {
      this.advance();
      return token;
    }

    this.failExpected(context, token);
  }

  protected consumeNumber(context: string): number {
    const token = this.current();

    if (token.kind === "number" && typeof token.value === "number") {
      this.advance();
      return token.value;
    }

    this.failExpected(context, token);
  }

  protected consumeBooleanValue(context: string): boolean {
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
