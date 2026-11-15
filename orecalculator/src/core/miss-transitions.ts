import type { ChangeSet } from './change.ts';

export type TransitionHistory = readonly (readonly [string, string])[];

// 同名の技を持つ別枠も区別できないため、技間の循環は保守的に除外する。
export function extendTransitions(history: TransitionHistory, set: ChangeSet): TransitionHistory | null {
  const edges: [string, string][] = history.map(([from, to]) => [from, to]);
  for (const { from, to } of set.changes) {
    const pending = [to];
    const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === from) return null;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const [source, destination] of edges) if (source === current) pending.push(destination);
    }
    if (!edges.some(([source, destination]) => source === from && destination === to)) edges.push([from, to]);
  }
  return edges.sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d));
}
