import type { SourceRange } from "../ast.js";

/**
 * The parser's own diagnostic shape and the error it throws. Separate from
 * `cursor.ts` so `../parser.ts` can re-export both without importing a class.
 */
export interface ParserDiagnostic {
  severity: "error";
  code:
    | "ADL_PARSE_EXPECTED_TOKEN"
    | "ADL_PARSE_UNEXPECTED_TOKEN"
    | "ADL_PARSE_UNSUPPORTED_PROCEDURAL_KEYWORD";
  message: string;
  sourceRange: SourceRange;
}

export class ParseError extends Error {
  readonly diagnostic: ParserDiagnostic;

  constructor(diagnostic: ParserDiagnostic) {
    super(
      `${diagnostic.message} at ${diagnostic.sourceRange.start.line}:${diagnostic.sourceRange.start.column}`,
    );
    this.name = "ParseError";
    this.diagnostic = diagnostic;
  }
}
