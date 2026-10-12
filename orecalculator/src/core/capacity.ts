import { slotCost } from './calc.ts';
import { SLOTS, costAt, r1, usableAt, type Reel, type Skill } from './types.ts';

export interface CapacityEstimate {
  lower: number | null;
  upper: number | null; // 排他的上限。null の場合は上限不明
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

    for (const id of sample.slots) {
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

  const highestSample = intervals.reduce((highest, interval) =>
    interval.lower > highest.lower ? interval : highest,
  );

  return { lower: highestSample.lower, upper: highestSample.upper };
}
