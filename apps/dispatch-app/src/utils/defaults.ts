/**
 * Merge a partial API response with full defaults to ensure all fields exist.
 * Guards against missing fields when the backend response is incomplete.
 */
export function withDefaults<T>(defaults: T, partial: Partial<T>): T {
  return { ...defaults, ...partial };
}
