import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { wrap } from "./router.js";

// Minimal Response double capturing the status/body that `sendError` writes.
function mockRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      this.headersSent = true;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: { error: string } | undefined };
}

// `wrap`'s returned handler resolves its work asynchronously inside a .catch;
// flush the microtask/timer queue before asserting.
const flush = () => new Promise((r) => setImmediate(r));

describe("wrap error mapping", () => {
  it("maps 'not found' errors to 404", async () => {
    const res = mockRes();
    const next = vi.fn();
    wrap(async () => {
      throw new Error("Ticket not found: x");
    })({} as Request, res, next);
    await flush();
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("maps other plain Errors (bad input) to 400", async () => {
    const res = mockRes();
    const next = vi.fn();
    wrap(async () => {
      throw new Error("Invalid status: bogus");
    })({} as Request, res, next);
    await flush();
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards programming bugs (TypeError) to next() instead of a 400", async () => {
    const res = mockRes();
    const next = vi.fn();
    wrap(async () => {
      throw new TypeError("Cannot read properties of undefined");
    })({} as Request, res, next);
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0); // no client error body written
  });

  it("forwards DB failures (SqliteError) to next() instead of a 400", async () => {
    const res = mockRes();
    const next = vi.fn();
    const err = new Error("disk I/O error");
    err.name = "SqliteError";
    wrap(async () => {
      throw err;
    })({} as Request, res, next);
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });
});
