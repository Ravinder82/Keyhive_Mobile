/**
 * Exclusive async mutex for read-modify-write sequences over shared storage.
 * MV3 dispatches onMessage handlers concurrently; without this, two
 * concurrent messages can interleave read→modify→write and lose updates.
 *
 * NOT reentrant by design — a locked section must only call unlocked
 * ("Unsafe"-suffixed) internals, never the public locked wrappers.
 */
let tail: Promise<unknown> = Promise.resolve();

export async function withExclusiveLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
