import { AsyncLocalStorage } from "node:async_hooks";

interface UserContext {
  username: string;
}

const userContext = new AsyncLocalStorage<UserContext>();

export function getCurrentUser(): string {
  return userContext.getStore()?.username ?? "local";
}

export function runAsUser<T>(username: string, fn: () => T): T {
  return userContext.run({ username }, fn);
}
