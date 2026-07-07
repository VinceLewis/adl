import type { SourcePosition, SourceRange } from "./ast.js";

export type TokenKind =
  | "identifier"
  | "string"
  | "number"
  | "boolean"
  | "symbol"
  | "newline"
  | "eof";

export interface Token {
  kind: TokenKind;
  lexeme: string;
  range: SourceRange;
  upper?: string;
  value?: string | number | boolean;
}

export interface LexerDiagnostic {
  severity: "error";
  code: "ADL_LEX_UNEXPECTED_CHARACTER" | "ADL_LEX_UNTERMINATED_STRING";
  message: string;
  sourceRange: SourceRange;
}

export class LexerError extends Error {
  readonly diagnostic: LexerDiagnostic;

  constructor(diagnostic: LexerDiagnostic) {
    super(
      `${diagnostic.message} at ${diagnostic.sourceRange.start.line}:${diagnostic.sourceRange.start.column}`,
    );
    this.name = "LexerError";
    this.diagnostic = diagnostic;
  }
}

export function lexAdl(source: string): Token[] {
  return new AdlLexer(source).lex();
}

class AdlLexer {
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  lex(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      const char = this.currentChar();

      if (char === " " || char === "\t" || char === "\f" || char === "\v") {
        this.advanceChar();
        continue;
      }

      if (char === "\r" || char === "\n") {
        tokens.push(this.readNewline());
        continue;
      }

      if (char === "#") {
        this.skipLineComment();
        continue;
      }

      if (char === "/" && this.peekChar() === "/") {
        this.skipLineComment();
        continue;
      }

      if (isIdentifierStart(char)) {
        tokens.push(this.readIdentifierOrBoolean());
        continue;
      }

      if (char === "'" || char === '"') {
        tokens.push(this.readString());
        continue;
      }

      if (isDigit(char) || (char === "-" && isDigit(this.peekChar()))) {
        tokens.push(this.readNumber());
        continue;
      }

      if (isSymbol(char)) {
        tokens.push(this.readSymbol());
        continue;
      }

      this.fail("ADL_LEX_UNEXPECTED_CHARACTER", `Unexpected character '${char}'.`, this.position());
    }

    const position = this.position();
    tokens.push({
      kind: "eof",
      lexeme: "",
      range: { start: position, end: position },
    });

    return tokens;
  }

  private readIdentifierOrBoolean(): Token {
    const start = this.position();
    let lexeme = "";

    while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
      lexeme += this.advanceChar();
    }

    const upper = lexeme.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
      return {
        kind: "boolean",
        lexeme,
        value: upper === "TRUE",
        range: { start, end: this.position() },
      };
    }

    return {
      kind: "identifier",
      lexeme,
      upper,
      range: { start, end: this.position() },
    };
  }

  private readString(): Token {
    const quote = this.currentChar();
    const start = this.position();
    let lexeme = this.advanceChar();
    let value = "";

    while (!this.isAtEnd()) {
      const char = this.currentChar();

      if (char === "\r" || char === "\n") {
        break;
      }

      lexeme += this.advanceChar();

      if (char === quote) {
        return {
          kind: "string",
          lexeme,
          value,
          range: { start, end: this.position() },
        };
      }

      if (char === "\\") {
        if (this.isAtEnd()) {
          break;
        }
        const escaped = this.advanceChar();
        lexeme += escaped;
        value += unescapeStringChar(escaped);
        continue;
      }

      value += char;
    }

    this.fail("ADL_LEX_UNTERMINATED_STRING", "Unterminated string literal.", start);
  }

  private readNumber(): Token {
    const start = this.position();
    let lexeme = "";

    if (this.currentChar() === "-") {
      lexeme += this.advanceChar();
    }

    while (!this.isAtEnd() && isDigit(this.currentChar())) {
      lexeme += this.advanceChar();
    }

    if (this.currentChar() === "." && isDigit(this.peekChar())) {
      lexeme += this.advanceChar();

      while (!this.isAtEnd() && isDigit(this.currentChar())) {
        lexeme += this.advanceChar();
      }
    }

    return {
      kind: "number",
      lexeme,
      value: Number(lexeme),
      range: { start, end: this.position() },
    };
  }

  private readNewline(): Token {
    const start = this.position();
    const lexeme = this.advanceNewline();

    return {
      kind: "newline",
      lexeme,
      range: { start, end: this.position() },
    };
  }

  private readSymbol(): Token {
    const start = this.position();
    const lexeme = this.advanceChar();

    return {
      kind: "symbol",
      lexeme,
      range: { start, end: this.position() },
    };
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.currentChar() !== "\r" && this.currentChar() !== "\n") {
      this.advanceChar();
    }
  }

  private currentChar(): string {
    return this.source[this.offset] ?? "";
  }

  private peekChar(distance = 1): string {
    return this.source[this.offset + distance] ?? "";
  }

  private advanceChar(): string {
    const char = this.source[this.offset];

    if (char === undefined) {
      return "";
    }

    this.offset += 1;
    this.column += 1;
    return char;
  }

  private advanceNewline(): string {
    if (this.currentChar() === "\r" && this.peekChar() === "\n") {
      this.offset += 2;
      this.line += 1;
      this.column = 1;
      return "\r\n";
    }

    const char = this.advanceChar();
    this.line += 1;
    this.column = 1;
    return char;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private position(): SourcePosition {
    return {
      line: this.line,
      column: this.column,
      offset: this.offset,
    };
  }

  private fail(code: LexerDiagnostic["code"], message: string, start: SourcePosition): never {
    throw new LexerError({
      severity: "error",
      code,
      message,
      sourceRange: { start, end: this.position() },
    });
  }
}

function isIdentifierStart(char: string): boolean {
  return /^[A-Za-z_]$/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
}

function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}

function isSymbol(char: string): boolean {
  return ["(", ")", ",", ".", "*"].includes(char);
}

function unescapeStringChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    default:
      return char;
  }
}
