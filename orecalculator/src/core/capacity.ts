import { slotCost } from './calc.ts';
import { SLOTS, costAt, r1, usableAt, type Reel, type Skill } from './types.ts';

export interface CapacityEstimate {
  lower: number | null;
  upper: number | null; // 排他的上限。null の場合は上限不明
  conflict?: boolean; // サンプル間に共通範囲がない
  unique?: number; // 0.2刻みと仮定したときに一意に定まるキャパ
}

/** サンプルの合計と、1枠を次のコスト段階に置き換えた最小合計から推定範囲を求める。 */
export function estimateCapacity(reel: Reel, skills: Skill[], reelCount: number): CapacityEstimate {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const usable = skills.filter((skill) => usableAt(skill, reel.level, reelCount));
  const samples = reel.samples.filter(
    (sample) => sample.slots.length === SLOTS && sample.slots.every((id) => byId.has(id)),
  );
  if (samples.length === 0) return { lower: null, upper: null };

  const intervals = samples.map((sample) => {
    const lower = slotCost(sample, skills, reel.level);
    let smallestIncrease = Number.POSITIVE_INFINITY;

    // 最も多い技(主力)は上限まで詰めた結果とみなし、残りの枠を上位の技に置き換えられたかで上限を見る。
    // 主力が決まらない(1種のみ・同数)ときは全枠を対象にする。
    const counts = new Map<string, number>();
    for (const id of sample.slots) counts.set(id, (counts.get(id) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const main = sorted.length > 1 && sorted[0][1] > sorted[1][1] ? sorted[0][0] : null;
    const targets = sample.slots.filter((id) => id !== main);

    for (const id of targets.length ? targets : sample.slots) {
      const current = byId.get(id)!;
      const currentCost = costAt(current, reel.level);
      for (const candidate of usable) {
        const increase = costAt(candidate, reel.level) - currentCost;
        if (increase > 0 && increase < smallestIncrease) smallestIncrease = increase;
      }
    }

    return {
      lower,
      upper: Number.isFinite(smallestIncrease) ? r1(lower + smallestIncrease) : null,
    };
  });

  const lower = Math.max(...intervals.map((i) => i.lower));
  const uppers = intervals.map((i) => i.upper).filter((u): u is number => u !== null);
  const upper = uppers.length ? Math.min(...uppers) : null;
  if (upper === null || lower < upper) return withUnique({ lower, upper });

  // 共通範囲がない場合は、最も高い下限のサンプルの範囲を採用する
  const highestSample = intervals.reduce((highest, interval) =>
    interval.lower > highest.lower ? interval : highest,
  );
  return withUnique({ lower: highestSample.lower, upper: highestSample.upper, conflict: true });
}

const STEP = 0.2; // キャパは0.2刻みと仮定

/** 範囲内に0.2刻みの値がちょうど1つなら、それを unique に入れる */
function withUnique(e: CapacityEstimate): CapacityEstimate {
  if (e.lower === null || e.upper === null) return e;
  const unit = Math.round(STEP * 10);
  const lo = Math.round(e.lower * 10);
  const hi = Math.round(e.upper * 10); // 排他的
  const first = Math.ceil(lo / unit) * unit;
  if (first < hi && first + unit >= hi) return { ...e, unique: r1(first / 10) };
  return e;
}
