import type { ErrorCode } from "../src/shared/types";

type Listener = (req: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;

export interface CallResult {
  ok: boolean;
  code?: ErrorCode | "no-async";
  message?: string;
  data?: unknown;
}

/** Sends a request through the REAL background router registered in setup. */
export function call(req: unknown): Promise<CallResult> {
  const fn = (globalThis as { __akListeners?: Listener[] }).__akListeners?.[0];
  if (!fn) throw new Error("background listener not registered");
  return new Promise((resolve) => {
    const more = fn(req, {}, (resp) => resolve(resp as CallResult));
    if (more === false) {
      resolve({ ok: false, code: "no-async", message: "listener returned false" });
    }
  });
}
