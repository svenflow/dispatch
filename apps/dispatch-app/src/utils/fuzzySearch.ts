import Fuse, { type IFuseOptions } from "fuse.js";

/**
 * Create a fuzzy search function with recency boosting.
 *
 * Returns items sorted by a combined score:
 *   - Fuse match quality (0 = perfect, 1 = worst)
 *   - Recency bonus (recent items get a score boost)
 *
 * When query is empty, returns items sorted by recency only.
 */
export function createFuzzySearch<T>(
  items: T[],
  opts: {
    /** Fuse.js keys to search */
    keys: IFuseOptions<T>["keys"];
    /** Extract a timestamp string for recency sorting. Return null if unavailable. */
    getTimestamp?: (item: T) => string | null;
  }
) {
  const { keys, getTimestamp } = opts;

  const fuse = new Fuse(items, {
    keys,
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    shouldSort: true,
  });

  return (query: string): T[] => {
    if (!query.trim()) {
      // No query — sort by recency if available, otherwise original order
      if (!getTimestamp) return items;
      return [...items].sort((a, b) => {
        const ta = getTimestamp(a);
        const tb = getTimestamp(b);
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return new Date(tb).getTime() - new Date(ta).getTime();
      });
    }

    const results = fuse.search(query);

    if (!getTimestamp) {
      return results.map((r) => r.item);
    }

    // Blend fuzzy score with recency
    const now = Date.now();
    const ONE_DAY = 86_400_000;

    const scored = results.map((r) => {
      const fuseScore = r.score ?? 1; // 0 = perfect match
      const ts = getTimestamp(r.item);
      let recencyBonus = 0;
      if (ts) {
        const ageMs = now - new Date(ts).getTime();
        const ageDays = ageMs / ONE_DAY;
        // Recency bonus: 0.2 for <1 hour, decays over 30 days
        recencyBonus = Math.max(0, 0.2 * (1 - ageDays / 30));
      }
      // Lower combined score = better
      const combinedScore = fuseScore - recencyBonus;
      return { item: r.item, combinedScore };
    });

    scored.sort((a, b) => a.combinedScore - b.combinedScore);
    return scored.map((s) => s.item);
  };
}
