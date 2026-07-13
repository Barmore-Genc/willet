/**
 * Error raised while parsing or compiling a ticket filter expression.
 *
 * Carries an optional 1-based column so callers (and agents reading the
 * message) can point at the offending token. The message is written to be
 * actionable on its own — the filter language is agent-facing, so a raw
 * parser dump like "Unable to consume token: >" is translated into something
 * a model can correct from.
 */
export class QueryError extends Error {
  /** 1-based column in the source filter string, when known. */
  readonly column?: number;

  constructor(message: string, column?: number) {
    super(message);
    this.name = "QueryError";
    this.column = column;
  }
}
