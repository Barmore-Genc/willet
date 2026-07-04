import {
  tok,
  alt_sc,
  seq,
  apply,
  kmid,
  kright,
  lrec_sc,
  list_sc,
  opt_sc,
  rule,
  expectEOF,
  expectSingleResult,
  type Token,
} from "typescript-parsec";
import { TokenKind, lexer } from "./lexer.js";
import { QueryError } from "./errors.js";
import type { CompareOp, FilterExpr, Interval, Literal } from "./ast.js";

// A single-quoted literal escapes an embedded quote by doubling it.
const unquote = (s: string): string => s.slice(1, -1).replace(/''/g, "'");

const normalizeOp = (op: string): CompareOp => (op === "<>" ? "!=" : (op as CompareOp));

function parseInterval(sign: string, duration: string): Interval {
  const amount = parseInt(duration.slice(0, -1), 10);
  const unit = duration.slice(-1).toLowerCase() as Interval["unit"];
  return { sign: sign as Interval["sign"], amount, unit };
}

// --- value := string | number | datefn ---

const dateFn = apply(
  seq(
    alt_sc(tok(TokenKind.Now), tok(TokenKind.Today)),
    tok(TokenKind.LParen),
    tok(TokenKind.RParen),
    opt_sc(seq(alt_sc(tok(TokenKind.Plus), tok(TokenKind.Minus)), tok(TokenKind.Duration)))
  ),
  ([fn, , , interval]): Literal => ({
    kind: "date",
    fn: fn.text.toLowerCase() as "now" | "today",
    interval: interval ? parseInterval(interval[0].text, interval[1].text) : null,
  })
);

const strVal = apply(tok(TokenKind.Str), (t): Literal => ({ kind: "string", value: unquote(t.text) }));
const numVal = apply(tok(TokenKind.Num), (t): Literal => ({ kind: "number", value: Number(t.text) }));
const value = alt_sc(strVal, numVal, dateFn);

// --- field predicate: field (OP value | [NOT] IN (...) | IS [NOT] NULL) ---

const fieldPred = apply(
  seq(
    tok(TokenKind.Ident),
    alt_sc(
      apply(seq(tok(TokenKind.Op), value), ([op, v]) => ({
        t: "compare" as const,
        op: normalizeOp(op.text),
        value: v,
      })),
      apply(
        seq(
          opt_sc(tok(TokenKind.Not)),
          tok(TokenKind.In),
          kmid(tok(TokenKind.LParen), list_sc(value, tok(TokenKind.Comma)), tok(TokenKind.RParen))
        ),
        ([neg, , values]) => ({ t: "in" as const, negated: !!neg, values })
      ),
      apply(seq(tok(TokenKind.Is), opt_sc(tok(TokenKind.Not)), tok(TokenKind.Null)), ([, neg]) => ({
        t: "null" as const,
        negated: !!neg,
      }))
    )
  ),
  ([field, rhs]): FilterExpr => {
    if (rhs.t === "compare") return { node: "compare", field: field.text, op: rhs.op, value: rhs.value };
    if (rhs.t === "in") return { node: "in", field: field.text, negated: rhs.negated, values: rhs.values };
    return { node: "null", field: field.text, negated: rhs.negated };
  }
);

// --- tag membership: 'value' [NOT] IN field ---

const tagMember = apply(
  seq(value, opt_sc(tok(TokenKind.Not)), tok(TokenKind.In), tok(TokenKind.Ident)),
  ([tag, neg, , field]): FilterExpr => ({
    node: "member",
    tag,
    negated: !!neg,
    field: field.text,
  })
);

// --- boolean structure, precedence: NOT > AND > OR ---

const EXPR = rule<TokenKind, FilterExpr>();
const notExpr = rule<TokenKind, FilterExpr>();

const primary = alt_sc(kmid(tok(TokenKind.LParen), EXPR, tok(TokenKind.RParen)), tagMember, fieldPred);

notExpr.setPattern(
  alt_sc(
    apply(kright(tok(TokenKind.Not), notExpr), (expr): FilterExpr => ({ node: "not", expr })),
    primary
  )
);

const andExpr = lrec_sc(
  notExpr,
  kright(tok(TokenKind.And), notExpr),
  (left, right): FilterExpr => ({ node: "and", left, right })
);

EXPR.setPattern(
  lrec_sc(
    andExpr,
    kright(tok(TokenKind.Or), andExpr),
    (left, right): FilterExpr => ({ node: "or", left, right })
  )
);

interface ParsecError {
  pos?: { columnBegin?: number };
  message?: string;
}

function toQueryError(err: ParsecError): QueryError {
  const column = err.pos?.columnBegin;
  const raw = err.message ?? "invalid filter expression";
  if (raw.includes("END-OF-FILE")) {
    return new QueryError(
      "Unexpected end of filter: the expression is incomplete (missing a value, or an unclosed parenthesis?)."
    );
  }
  const consumed = raw.match(/Unable to consume token: (.+)$/);
  if (consumed) {
    return new QueryError(`Unexpected token "${consumed[1]}" in filter.`, column);
  }
  return new QueryError(raw, column);
}

/**
 * Parse a filter string into a {@link FilterExpr} AST. Pure: no field catalog,
 * no SQL, no mode awareness. Throws {@link QueryError} on a syntax error.
 */
export function parseFilter(input: string): FilterExpr {
  let out;
  try {
    out = expectEOF(EXPR.parse(lexer.parse(input)));
  } catch (e) {
    throw toQueryError(e as ParsecError);
  }
  if (!out.successful) throw toQueryError(out.error as ParsecError);
  try {
    return expectSingleResult(out);
  } catch (e) {
    throw toQueryError(e as ParsecError);
  }
}

export type { Token };
