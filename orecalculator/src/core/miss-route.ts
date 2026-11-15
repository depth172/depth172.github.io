import { applyChange, changeDistribution, type WeightedChange } from './change.ts';
import { type Monster } from './types.ts';
import { extendTransitions, type TransitionHistory } from './miss-transitions.ts';

export interface RouteStep {
  monster: Monster;
  accepted: number;
  outcomes: WeightedChange[];
  acceptedKeys: string[];
  expectedBattles: number;
}
export interface MissRoute { steps: RouteStep[]; expectedBattles: number }
interface Entry {
  monster: Monster;
  accepted: number;
  parent: number;
  acceptedKeys: string[];
  probability: number;
  distance: number;
  outcomes: WeightedChange[];
  history: TransitionHistory;
}

export function changeKey(set: WeightedChange['set']): string {
  return JSON.stringify([set.kind, set.changes.map((c) => JSON.stringify([c.reelIndex, c.from, c.to])).sort()]);
}

/** 対象外リール、ミス減少、既出の配置への変化を拒否して経路を探す。 */
export function findMissRoute(monster: Monster, reelIndex: number, target: number, maxExpanded: number): MissRoute | null {
  const misses = new Set(monster.skills.filter((s) => s.isMiss).map((s) => s.id));
  const count = (m: Monster) => m.reels[reelIndex].slots.filter((id) => misses.has(id)).length;
  const key = (m: Monster, accepted: number, history: TransitionHistory) => JSON.stringify([accepted, m.reels[reelIndex].slots, history]);
  const entries: Entry[] = [{ monster, accepted: 0, parent: -1, acceptedKeys: [], probability: 1, distance: 0, outcomes: [], history: [] }];
  const seen = new Map<string, number>([[key(monster, 0, []), 0]]);
  const pending: { index: number; distance: number }[] = [{ index: 0, distance: 0 }];
  let bestGoal: Entry | null = null;
  for (let expanded = 0; pending.length && expanded < maxExpanded; expanded++) {
    pending.sort((a, b) => b.distance - a.distance);
    const item = pending.pop()!;
    const index = item.index;
    const entry = entries[index];
    if (seen.get(key(entry.monster, entry.accepted, entry.history)) !== index) { expanded--; continue; }
    if (bestGoal && entry.distance >= bestGoal.distance) break;
    const visitedLayouts = new Set<string>();
    for (let ancestor = index; ancestor >= 0; ancestor = entries[ancestor].parent) {
      visitedLayouts.add(JSON.stringify(entries[ancestor].monster.reels[reelIndex].slots));
    }
    const outcomes = changeDistribution(entry.monster, { legacy: entry.accepted < 10 }, true);
    entry.outcomes = outcomes;
    const destinations = new Map<string, { monster: Monster; probability: number; keys: string[]; history: TransitionHistory }>();
    for (const outcome of outcomes) {
      if (outcome.set.changes.some((change) => change.reelIndex !== reelIndex)) continue;
      const history = extendTransitions(entry.history, outcome.set);
      if (!history) continue;
      const next = { ...entry.monster, reels: entry.monster.reels.map((r) => ({ ...r, slots: [...r.slots] })) };
      applyChange(next, outcome.set);
      next.reels[reelIndex].slots.sort();
      if (count(next) < count(entry.monster)) continue;
      if (visitedLayouts.has(JSON.stringify(next.reels[reelIndex].slots))) continue;
      const k = key(next, Math.min(10, entry.accepted + 1), history);
      const old = destinations.get(k);
      if (old) { old.probability += outcome.probability; old.keys.push(changeKey(outcome.set)); }
      else destinations.set(k, { monster: next, probability: outcome.probability, keys: [changeKey(outcome.set)], history });
    }
    for (const [k, dest] of destinations) {
      const accepted = Math.min(10, entry.accepted + 1);
      const distance = entry.distance + 1 / dest.probability;
      if (bestGoal && distance >= bestGoal.distance) continue;
      const child: Entry = { monster: dest.monster, accepted, parent: index, acceptedKeys: dest.keys, probability: dest.probability, outcomes: [], distance, history: dest.history };
      if (count(dest.monster) >= target) { bestGoal = child; continue; }
      const found = seen.get(k);
      if (found !== undefined) {
        if (entries[found].distance <= distance) continue;
      }
      const childIndex = entries.length;
      entries.push(child); seen.set(k, childIndex);
      pending.push({ index: childIndex, distance });
    }
  }
  if (!bestGoal) return null;
  const path = [bestGoal];
  let parent = bestGoal.parent;
  while (parent >= 0) { path.push(entries[parent]); parent = entries[parent].parent; }
  path.reverse();
  let remaining = 0;
  const steps: RouteStep[] = [];
  for (let i = path.length - 2; i >= 0; i--) {
    remaining += 1 / path[i + 1].probability;
    steps.unshift({ monster: path[i].monster, accepted: path[i].accepted, outcomes: path[i].outcomes, acceptedKeys: path[i + 1].acceptedKeys, expectedBattles: remaining });
  }
  return { steps, expectedBattles: remaining };
}
