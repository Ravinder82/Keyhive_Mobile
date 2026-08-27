/**
 * Minimal HTTPS transport used by all provider adapters.
 * Requests go directly from the extension service worker to the provider over
 * HTTPS — there is no AI Keychain proxy or intermediary server.
 */

export class TransportError extends Error {
  constructor(public readonly kind: "timeout" | "network") {
    super(kind === "timeout" ? "Request timed out." : "Network request failed.");
    this.name = "TransportError";
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TransportError("timeout");
    }
    throw new TransportError("network");
  } finally {
    clearTimeout(timer);
  }
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — no provider response needs more

/** Reads a JSON response body with a hard size cap; hostile/broken 2xx
 * streams cannot exhaust service-worker memory. Returns undefined when the
 * body is absent, oversized, or not valid JSON. */
export async function readJsonBody(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        void reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    return undefined;
  }
}
