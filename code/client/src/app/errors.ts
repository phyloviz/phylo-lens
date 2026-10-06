/** JavaScript can throw any value. Keep that uncertainty at the catch boundary. */
export function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(typeof value === 'string' ? value : 'unknown error', { cause: value });
}
