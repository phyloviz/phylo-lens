export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Plain, acyclic test data only; runtime objects such as DOM nodes remain mutable. */
export function freezeInput<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeInput);
    Object.freeze(value);
  }
  return value;
}
