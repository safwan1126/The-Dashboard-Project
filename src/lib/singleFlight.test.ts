import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./singleFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("createSingleFlight", () => {
  it("runs the work once for concurrent callers on the same key", async () => {
    const run = createSingleFlight<string>();
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);

    const first = run("k", fn);
    const second = run("k", fn);

    expect(fn).toHaveBeenCalledTimes(1);

    d.resolve("value");
    // The regression this guards: the late caller must get the result too,
    // not be turned away empty-handed.
    expect(await first).toBe("value");
    expect(await second).toBe("value");
  });

  it("keeps separate keys independent", async () => {
    const run = createSingleFlight<string>();
    const fn = vi.fn((v: string) => Promise.resolve(v));

    const [a, b] = await Promise.all([
      run("a", () => fn("a")),
      run("b", () => fn("b")),
    ]);

    expect(fn).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(["a", "b"]);
  });

  it("releases the key once settled, so a later call re-runs", async () => {
    const run = createSingleFlight<number>();
    let calls = 0;
    const fn = () => Promise.resolve(++calls);

    expect(await run("k", fn)).toBe(1);
    expect(await run("k", fn)).toBe(2);
  });

  it("releases the key when the work rejects", async () => {
    const run = createSingleFlight<string>();
    const failing = () => Promise.reject(new Error("boom"));

    await expect(run("k", failing)).rejects.toThrow("boom");

    // A rejection must not leave the key stuck in flight forever.
    expect(await run("k", () => Promise.resolve("recovered"))).toBe("recovered");
  });

  it("gives concurrent callers the same rejection", async () => {
    const run = createSingleFlight<string>();
    const d = deferred<string>();
    const first = run("k", () => d.promise);
    const second = run("k", () => d.promise);

    d.reject(new Error("boom"));

    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("boom");
  });
});
