// Collapses concurrent calls that share a key onto one underlying promise.
//
// The subtlety this exists for: a caller arriving while a request is already in
// flight must receive that request's result, not be turned away. React
// StrictMode remounts effects in development, so the surviving pass is exactly
// such a late caller — turn it away and the fetched data is dropped by both
// passes, leaving the UI empty.

export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return function run(key: string, fn: () => Promise<T>): Promise<T> {
    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = fn().finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, request);
    return request;
  };
}
