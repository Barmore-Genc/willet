// Query/body parsing helpers for the REST API. Express query values arrive as
// strings (or string arrays for repeated keys); these coerce them into the
// shapes the @willet/shared query functions expect, and throw on bad input so
// `wrap` can turn the error into a 400.

import { z } from "zod";

/** Coerce a query value into a string array (accepts repeated or single keys). */
export function asArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** Coerce a query value into a single string. */
export function asString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? String(value[0]) : String(value);
}

/** Parse a boolean query flag ("true"/"1" → true). */
export function asBool(value: unknown): boolean | undefined {
  const s = asString(value);
  if (s === undefined) return undefined;
  return s === "true" || s === "1";
}

/** Parse an integer query value; throws on a non-integer string. */
export function asInt(value: unknown, label: string): number | undefined {
  const s = asString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new Error(`Invalid ${label}: expected an integer`);
  return n;
}

/** Validate a request body against a zod schema; throw a 400-style error on failure. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.length ? `${first.path.join(".")}: ` : "";
    throw new Error(`${path}${first.message}`);
  }
  return result.data;
}
