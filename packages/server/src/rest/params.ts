// Query/body parsing helpers for the REST API. Express query values arrive as
// strings (or string arrays for repeated keys); these coerce them into the
// shapes the @willet/shared query functions expect, and throw on bad input so
// `wrap` can turn the error into a 400.

import { z } from "zod";
import type { Request } from "express";

/**
 * Read a path param as a single string. Express 5 types params as
 * `string | string[] | undefined`; collapse arrays and reject a missing param
 * rather than silently passing `undefined` into the query functions.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined) {
    throw new Error(`Missing path parameter: ${name}`);
  }
  return single;
}

/**
 * Parse a request body as JSON, tolerating (or absent) Content-Type. The body
 * arrives as a raw string (see the router's text parser); empty bodies become
 * `{}` so optional-only schemas validate, and invalid JSON throws a clear error
 * `wrap` turns into a 400 — instead of a confusing "field: Required".
 */
function asJson(body: unknown): unknown {
  if (body === undefined || body === null) return {};
  if (typeof body !== "string") return body;
  if (body.trim() === "") return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body is not valid JSON");
  }
}

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
  const result = schema.safeParse(asJson(body));
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.length ? `${first.path.join(".")}: ` : "";
    throw new Error(`${path}${first.message}`);
  }
  return result.data;
}
