import type { BlockName, EndMarkerNode, SourceRange, StyleWarningAst } from "../ast.js";
import type { LexedComment, Token } from "../lexer.js";
import { ParseError } from "./diagnostics.js";
import type { ParserDiagnostic } from "./diagnostics.js";

/**
 * Token cursor and parser state: the shared index, the token/word/symbol
 * matchers every grammar area builds on, block `END.` handling, style-warning
 * recording, leading-comment capture, and the failure helpers.
 */
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

export class CursorParser {
  private currentIndex = 0;

  /** See `StyleWarningAst`. Populated by `recordDeprecatedSpelling` as parsing proceeds. */
  protected readonly styleWarnings: StyleWarningAst[] = [];

  /** `LexedComment[]` indexed by 1-based source line, for `takeLeadingComment`. */
  private readonly commentsByLine: Map<number, string>;

  constructor(
    private readonly tokens: Token[],
    comments: LexedComment[] = [],
  ) {
    this.commentsByLine = new Map(comments.map((comment) => [comment.line, comment.text]));
  }

  /**
   * The leading comment block immediately above the current token, if any:
   * one or more consecutive whole-line `#`/`//` comments with no blank line
   * between them and none between the block and the current token's own
   * line, joined with `\n` in source order. Call this as the first thing in
   * a construct's `parseXxx` method, before consuming its first token, so
   * "the current token" is still that construct's own opening keyword — the
   * line the comment block must end immediately above. A comment separated
   * by a blank line, or one trailing on the same line as other content, has
   * no attachment point and is never returned by any call.
   */
  protected takeLeadingComment(): string | undefined {
    const lines: string[] = [];
    let line = this.current().range.start.line - 1;

    while (this.commentsByLine.has(line)) {
      lines.unshift(this.commentsByLine.get(line) as string);
      line -= 1;
    }

    return lines.length === 0 ? undefined : lines.join("\n");
  }

  /**
   * Records use of a deprecated-but-still-accepted spelling. The parser
   * never refuses these; `compileAdl` turns the collection into
   * warning-severity `ADL_STYLE_DEPRECATED_SPELLING` diagnostics so an
   * author sees the drift without a build ever breaking. `token` should be
   * the first token of the deprecated spelling.
   */
  protected recordDeprecatedSpelling(
    construct: string,
    deprecated: string,
    canonical: string,
    token: Token,
  ): void {
    this.styleWarnings.push({
      construct,
      deprecated,
      canonical,
      range: { start: token.range.start, end: this.previous().range.end },
    });
  }

  /**
   * `this.matchWord(canonical) || this.matchWord(deprecated)`, tracking
   * which spelling matched. Use for a plain alias pair with no structural
   * difference between the two spellings.
   */
  protected matchCanonicalOrDeprecatedWord(
    construct: string,
    canonical: string,
    deprecated: string,
  ): boolean {
    const token = this.current();
    if (this.matchWord(canonical)) {
      return true;
    }
    if (this.matchWord(deprecated)) {
      this.recordDeprecatedSpelling(construct, deprecated, canonical, token);
      return true;
    }
    return false;
  }

  /**
   * `this.matchWord(underscoreWord) || this.matchDottedWord(first, second)`,
   * tracking which spelling matched. Every `X_Y`/`X.Y` keyword pair in this
   * grammar shares this shape (Phase 59 established underscore as the
   * canonical form; the dotted spelling is accepted for compatibility only).
   */
  protected matchUnderscoreOrDottedWord(
    construct: string,
    underscoreWord: string,
    first: string,
    second: string,
  ): boolean {
    const token = this.current();
    if (this.matchWord(underscoreWord)) {
      return true;
    }
    if (this.matchDottedWord(first, second)) {
      this.recordDeprecatedSpelling(construct, `${first}.${second}`, underscoreWord, token);
      return true;
    }
    return false;
  }

  /** `expectWord`/`expectDottedWord` counterpart to `matchUnderscoreOrDottedWord`. */
  protected expectUnderscoreOrDottedWord(
    construct: string,
    underscoreWord: string,
    first: string,
    second: string,
    context: string,
  ): Token {
    if (this.checkWord(underscoreWord)) {
      return this.expectWord(underscoreWord, context);
    }
    const token = this.expectDottedWord(first, second, context);
    this.recordDeprecatedSpelling(construct, `${first}.${second}`, underscoreWord, token);
    return token;
  }

  protected parseEnd(name: BlockName): EndMarkerNode {
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

  protected checkEnd(name: BlockName): boolean {
    return (
      this.checkWord("END") &&
      this.peek(1).kind === "symbol" &&
      this.peek(1).lexeme === "." &&
      this.peek(2).kind === "identifier" &&
      this.peek(2).upper === name
    );
  }

  protected expectWord(word: string, context: string): Token {
    const token = this.current();

    if (this.matchWord(word)) {
      return token;
    }

    this.failExpected(context, token);
  }

  protected matchWord(word: string): boolean {
    if (!this.checkWord(word)) {
      return false;
    }

    this.advance();
    return true;
  }

  protected checkWord(word: string): boolean {
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

  protected checkDottedWord(first: string, second: string): boolean {
    return (
      this.checkWord(first) &&
      this.peek(1).kind === "symbol" &&
      this.peek(1).lexeme === "." &&
      this.peek(2).kind === "identifier" &&
      this.peek(2).upper === second
    );
  }

  protected expectSymbol(symbol: string, context: string): Token {
    const token = this.current();

    if (this.matchSymbol(symbol)) {
      return token;
    }

    this.failExpected(context, token);
  }

  protected matchSymbol(symbol: string): boolean {
    if (!this.checkSymbol(symbol)) {
      return false;
    }

    this.advance();
    return true;
  }

  protected checkSymbol(symbol: string): boolean {
    const token = this.current();
    return token.kind === "symbol" && token.lexeme === symbol;
  }

  protected skipComma(): void {
    while (this.matchSymbol(",")) {
      // Consume separator.
    }
  }

  protected skipNewlines(): void {
    while (this.current().kind === "newline") {
      this.advance();
    }
  }

  protected consumeLineEnd(context: string): void {
    if (this.current().kind === "eof") {
      return;
    }

    if (this.current().kind !== "newline") {
      this.failExpected(`end of line after ${context}`, this.current());
    }

    this.skipNewlines();
  }

  protected isLineEnd(): boolean {
    const token = this.current();
    return token.kind === "newline" || token.kind === "eof";
  }

  protected currentWordIsAny(words: Set<string>): boolean {
    const token = this.current();
    return token.kind === "identifier" && words.has(token.upper ?? "");
  }

  protected previous(): Token {
    return this.tokens[Math.max(0, this.currentIndex - 1)] ?? this.current();
  }

  protected current(): Token {
    return this.tokens[this.currentIndex] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peek(distance: number): Token {
    return this.tokens[this.currentIndex + distance] ?? this.tokens[this.tokens.length - 1]!;
  }

  protected advance(): Token {
    const token = this.current();
    if (!this.isAtEnd()) {
      this.currentIndex += 1;
    }
    return token;
  }

  protected isAtEnd(): boolean {
    return this.current().kind === "eof";
  }

  protected rangeFrom(startToken: Token): SourceRange {
    return {
      start: startToken.range.start,
      end: this.previous().range.end,
    };
  }

  protected failExpected(expected: string, token: Token): never {
    this.fail(
      "ADL_PARSE_EXPECTED_TOKEN",
      `Expected ${expected}, but found ${describeToken(token)}.`,
      token,
    );
  }

  protected failUnexpected(expected: string): never {
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

  protected fail(code: ParserDiagnostic["code"], message: string, token: Token): never {
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
