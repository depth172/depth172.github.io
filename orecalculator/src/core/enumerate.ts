import { SLOTS, costAt, r1, usableAt, type Skill } from './types.ts';

export interface Layout {
  ids: string[];
  cost: number;
}

export interface EnumOptions {
  capacity: number;
  level: number;
  reelCount: number;
  min?: Record<string, number>;
  max?: Record<string, number>;
  limit?: number;
}

export interface EnumResult {
  layouts: Layout[];
  truncated: boolean;
}

export const defaultMax = (kind: Skill['kind']): number => (kind === 'up' ? SLOTS : 1);

/** コスト合計 ≤ capacity となる6枠の多重集合を列挙する。 */
export function enumerate(skills: Skill[], opt: EnumOptions): EnumResult {
  const limit = opt.limit ?? 20000;
  const usable = skills
    .filter((s) => usableAt(s, opt.level, opt.reelCount))
    .filter((s) => (opt.max?.[s.id] ?? defaultMax(s.kind)) > 0)
    .map((s) => ({ ...s, cost: costAt(s, opt.level) }))
    .sort((a, b) => a.cost - b.cost);

  const layouts: Layout[] = [];
  let truncated = false;
  const counts = new Array<number>(usable.length).fill(0);

  const dfs = (i: number, rem: number, sum: number) => {
    if (truncated) return;
    if (rem === 0) {
      if (usable.some((s, k) => counts[k] < (opt.min?.[s.id] ?? 0))) return;
      if (layouts.length >= limit) {
        truncated = true;
        return;
      }
      const ids: string[] = [];
      counts.forEach((c, k) => {
        for (let n = 0; n < c; n++) ids.push(usable[k].id);
      });
      layouts.push({ ids, cost: sum });
      return;
    }
    for (let k = i; k < usable.length; k++) {
      // コスト昇順なので、以降どの技を選んでも残り枠のコストは cost[k]*rem 以上
      if (r1(sum + usable[k].cost * rem) > opt.capacity) break;
      const max = Math.min(rem, opt.max?.[usable[k].id] ?? defaultMax(usable[k].kind));
      for (let n = 1; n <= max; n++) {
        counts[k] = n;
        dfs(k + 1, rem - n, r1(sum + usable[k].cost * n));
      }
      counts[k] = 0;
    }
  };
  dfs(0, SLOTS, 0);
  layouts.sort((a, b) => b.cost - a.cost);
  return { layouts, truncated };
}

