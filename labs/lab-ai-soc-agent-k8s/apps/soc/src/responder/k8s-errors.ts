import { ApiException } from "@kubernetes/client-node";

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiException && err.code === 404;
}

export function isAlreadyExists(err: unknown): boolean {
  return err instanceof ApiException && err.code === 409;
}
