/**
 * Domain errors carry a machine-readable ErrorCode so the background router
 * can emit precise, user-safe responses (never generic "internal").
 */
import type { ErrorCode } from "../shared/types";

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
