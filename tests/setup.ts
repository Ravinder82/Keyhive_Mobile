/**
 * Test bootstrap: an in-memory chrome.* mock so extension modules run under
 * Vitest/jsdom. Storage maps reset between tests.
 */
import { beforeEach } from "vitest";

type Store = Map<string, unknown>;

function memArea(store: Store) {
  return {
    async get(keys: string | Record<string, unknown>): Promise<Record<string, unknown>> {
      const out: Record<string, unknown> = {};
      const wanted =
        typeof keys === "string" ? [keys] : keys === undefined ? [...store.keys()] : Object.keys(keys);
      for (const k of wanted) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async set(obj: Record<string, unknown>): Promise<void> {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async clear(): Promise<void> {
      store.clear();
    },
  };
}

const localStore: Store = new Map();
const sessionStore: Store = new Map();

export const mockStorage = { local: localStore, session: sessionStore };

export type SendMessageMock = (req: unknown) => Promise<unknown> | unknown;
let sendMessageImpl: SendMessageMock = () => {
  throw new Error("sendMessage mock not configured");
};

export function setSendMessageMock(fn: SendMessageMock): void {
  sendMessageImpl = fn;
}

type MessageListener = (req: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;
const messageListeners: MessageListener[] = [];
(globalThis as { __akListeners?: MessageListener[] }).__akListeners = messageListeners;

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      local: memArea(localStore),
      session: memArea(sessionStore),
    },
    runtime: {
      sendMessage: (req: unknown) => Promise.resolve(sendMessageImpl(req)),
      onMessage: {
        addListener: (fn: MessageListener) => messageListeners.push(fn),
      },
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    tabs: {
      create: () => undefined,
    },
  },
});

beforeEach(() => {
  localStore.clear();
  sessionStore.clear();
  // Note: messageListeners are NOT cleared — the background module registers
  // its router once per worker/test-file and must keep receiving messages.
});
