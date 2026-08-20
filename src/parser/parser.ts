import type { AdlDocumentAst } from "./ast.js";
import type { ResolvedExpression } from "../model/resolved-model.js";
import { lexAdlWithComments } from "./lexer.js";
import { AdlParser } from "./grammar/index.js";

export { ParseError } from "./grammar/diagnostics.js";
export type { ParserDiagnostic } from "./grammar/diagnostics.js";

export function parseAdl(source: string): AdlDocumentAst {
  const { tokens, comments } = lexAdlWithComments(source);
  return new AdlParser(tokens, comments).parseDocument();
}

/**
 * Parses exactly one expression from `text`, using the identical infix
 * expression grammar `.adl` text uses in a `VALIDATE`/`WHEN`/`WHERE`
 * position (Phase 73's `.adlj` front-end reuses this to parse the fields it
 * keeps as strings rather than JSON expression trees). Unlike the block
 * parser, this is not "parse as much as the grammar allows and stop" —
 * trailing content after a complete expression is a parse error
 * (`ADL_PARSE_UNEXPECTED_TOKEN`), not a silently-ignored suffix, so a typo
 * like `"EndDate >= StartDate extra"` fails loudly rather than parsing a
 * prefix.
 */
export function parseExpressionSource(text: string): ResolvedExpression {
  return new AdlParser(lexAdlWithComments(text).tokens).parseStandaloneExpression();
}
