import { buildLexer } from "typescript-parsec";

/**
 * Token kinds for the filter language.
 *
 * Keywords (`AND`, `IN`, `IS NULL`, `now`, …) and operators are
 * case-insensitive — the lexer rules carry the `i` flag — so agents don't
 * have to remember casing on syntax. Field names and values are handled by
 * the parser/compiler, not here.
 */
export enum TokenKind {
  Space,
  And,
  Or,
  Not,
  In,
  Is,
  Null,
  Now,
  Today,
  Op, // comparison operator: = != <> < <= > >=
  LParen,
  RParen,
  Comma,
  Plus,
  Minus,
  Duration, // e.g. 7d, 12h, 2w
  Str, // single-quoted, '' escapes a quote
  Num,
  Ident, // field name; may contain dots for metadata.<key>
}

// Order matters: longest match wins, ties go to the first-listed rule.
// Keyword rules use \b so they don't swallow identifiers like `internal`
// (which starts with `in`) or `nowhere` (which starts with `now`).
export const lexer = buildLexer<TokenKind>([
  [false, /^\s+/g, TokenKind.Space],
  [true, /^and\b/gi, TokenKind.And],
  [true, /^or\b/gi, TokenKind.Or],
  [true, /^not\b/gi, TokenKind.Not],
  [true, /^in\b/gi, TokenKind.In],
  [true, /^is\b/gi, TokenKind.Is],
  [true, /^null\b/gi, TokenKind.Null],
  [true, /^now\b/gi, TokenKind.Now],
  [true, /^today\b/gi, TokenKind.Today],
  [true, /^(?:!=|<>|<=|>=|=|<|>)/g, TokenKind.Op],
  [true, /^\(/g, TokenKind.LParen],
  [true, /^\)/g, TokenKind.RParen],
  [true, /^,/g, TokenKind.Comma],
  [true, /^\+/g, TokenKind.Plus],
  [true, /^-/g, TokenKind.Minus],
  [true, /^\d+[dhw]\b/gi, TokenKind.Duration],
  [true, /^'(?:[^']|'')*'/g, TokenKind.Str],
  [true, /^\d+(?:\.\d+)?/g, TokenKind.Num],
  [true, /^[A-Za-z_][A-Za-z0-9_.]*/g, TokenKind.Ident],
]);
