import { slotCost } from './calc.ts';
import { costAt, costTier, r1, usableAt, type CostTier, type Monster, type Reel, type Skill } from './types.ts';

export interface Change {
  reelIndex: number;
  slotIndex: number;
  from: string;
  to: string;
}

/** up: 通常の変化(コストが上がる/新仕様では任意) degrade: 劣化 double: ダブル変化(同時に2枠) */
export type ChangeKind = 'up' | 'degrade' | 'double';

export interface ChangeSet {
  kind: ChangeKind;
  changes: Change[];
}

/** 劣化・ダブル変化が起こる条件: リールの残りキャパ(キャパ − 合計コスト)がこの値以下 */
export const DEGRADE_MAX_REST = 1;
/** バトル終了ごとにダブル変化になる確率 */
export const DOUBLE_CHANCE = 0.1;

/** 旧仕様(レベル9以下)用: 移動技の枠・枠組が変化対象に選ばれる相対的な重み */
export const SHIFT_SLOT_WEIGHT = 0.01;
/** 旧仕様用: リールの残りキャパがこの値以下なら「キャパ上限近く」として移動技の重み低下を無効にする */
export const NEAR_CAPACITY_REST = 1;
/** 旧仕様用: 変化先の色ごとの重み(同じ色の中は同じ確率。高い色ほど選ばれやすい。移動系も色はコストで判定) */
export const TIER_WEIGHT: Record<CostTier, number> = { beige: 1, bronze: 3, silver: 6, gold: 10 };
/** 旧仕様用: 低ティア(ベージュ・ブロンズ)の移動系が変化先に選ばれる重みの倍率 */
export const LOW_TIER_SHIFT_BOOST = 1.5;
const LOW_TIERS: CostTier[] = ['beige', 'bronze'];
/** 旧仕様用: 劣化する変化先の相対的な重み */
export const DEGRADE_TARGET_WEIGHT = 0.1;
/** キャパ上限付近では、移動元の単独変化の合計を通常技の劣化の合計に対してこの比率以下にする */
export const MAX_SHIFT_TO_DEGRADE_CHANCE = 0.01;

export const isShift = (s: Skill): boolean => s.kind !== 'normal' && s.kind !== 'down';

interface Ctx {
  m: Monster;
  reel: Reel;
  slotIndex: number;
  from: Skill;
  to: Skill;
}

/** 変化後のコスト合計がキャパ内に収まること(単独変化の共通条件) */
function fitsCapacity({ m, reel, slotIndex, to }: Ctx): boolean {
  const slots = reel.slots.map((v, j) => (j === slotIndex ? to.id : v));
  return r1(slotCost({ slots }, m.skills, reel.level)) <= reel.capacity;
}

type SlotWeightRule = (m: Monster, reel: Reel, from: Skill, byId: Map<string, Skill>) => number;

// 旧仕様の枠選択の重みルール(追加はここに足す。各ルールの値を掛け合わせる)
const legacySlotWeightRules: SlotWeightRule[] = [
  // 移動技はほぼ変化対象にならない。ただしキャパ上限近く・全枠が移動技のときは対象外
  (m, reel, from, byId) => {
    if (!isShift(from)) return 1;
    const rest = r1(reel.capacity - slotCost(reel, m.skills, reel.level));
    const allShift = reel.slots.every((id) => {
      const s = byId.get(id);
      return !!s && isShift(s);
    });
    return rest <= NEAR_CAPACITY_REST || allShift ? 1 : SHIFT_SLOT_WEIGHT;
  },
];

// 旧仕様の変化先の重みルール(追加はここに足す。各ルールの値を掛け合わせる)
const legacyTargetWeightRules: ((c: Ctx) => number)[] = [
  // 色が高い技ほど選ばれやすい(同じ色の中は一様)
  (c) => TIER_WEIGHT[costTier(costAt(c.to, c.reel.level))],
  // 低ティアの移動系は若干出やすい
  (c) => (isShift(c.to) && LOW_TIERS.includes(costTier(costAt(c.to, c.reel.level))) ? LOW_TIER_SHIFT_BOOST : 1),
  // 劣化する変化先は選ばれにくい。
  (c) => (r1(costAt(c.from, c.reel.level) - costAt(c.to, c.reel.level)) > 0 ? DEGRADE_TARGET_WEIGHT : 1),
];

/** 新仕様(Lv10以上): ミスはほぼ変化先にならない(ミスからの変化は通常どおり起こる) */
export const MISS_TARGET_WEIGHT = 0.02;
const newTargetWeight = (c: Ctx): number => (c.to.isMiss ? MISS_TARGET_WEIGHT : 1);

interface Group {
  weight: number;
  kind: ChangeKind;
  pool: Change[][];
  poolWeights?: number[]; // 候補ごとの重み(未指定は一様)
  poolKinds?: ChangeKind[]; // 候補ごとの種別(未指定は kind)
  shifts: number; // 変化前の技のうち移動技の数
}

function slotWeight(m: Monster, reel: Reel, from: Skill, byId: Map<string, Skill>, legacy: boolean): number {
  return legacy ? legacySlotWeightRules.reduce((w, rule) => w * rule(m, reel, from, byId), 1) : 1;
}

/** 重み付きでグループを選び、その中の候補を(重みがあれば重み付きで)選ぶ */
function draw(groups: Group[], rng: () => number): ChangeSet | null {
  if (groups.length === 0) return null;
  let t = rng() * groups.reduce((sum, g) => sum + g.weight, 0);
  const g = groups.find((x) => (t -= x.weight) < 0) ?? groups[groups.length - 1];
  const w = g.poolWeights;
  const pick = (i: number): ChangeSet => ({ kind: g.poolKinds?.[i] ?? g.kind, changes: g.pool[i] });
  if (!w) return pick(Math.floor(rng() * g.pool.length));
  let u = rng() * w.reduce((a, b) => a + b, 0);
  const idx = w.findIndex((x) => (u -= x) < 0);
  return pick(idx < 0 ? w.length - 1 : idx);
}

/** 移動技を含む候補の重みを下げる。 */
function protectShift(groups: Group[]): Group[] {
  if (!groups.some((g) => g.shifts === 0)) return groups;
  for (const g of groups) g.weight *= SHIFT_SLOT_WEIGHT ** g.shifts;
  return groups;
}

function singleGroups(m: Monster, legacy: boolean, byId: Map<string, Skill>): Group[] {
  const groups: Group[] = [];
  m.reels.forEach((reel, reelIndex) => {
    const rest = r1(reel.capacity - slotCost(reel, m.skills, reel.level));
    const canDegrade = legacy && rest <= DEGRADE_MAX_REST;
    const usableSkills = canDegrade
      ? m.skills.filter((skill) => usableAt(skill, reel.level, m.reels.length))
      : [];
    const lowerDrops = new Map<number, { nearest: number; extraNormal: number | null }>();
    const shiftGroups: Group[] = [];
    let normalDegradeWeight = 0;
    reel.slots.forEach((fromId, slotIndex) => {
      const from = byId.get(fromId);
      if (!from) return;
      const fromCost = costAt(from, reel.level);
      const fit: Ctx[] = [];
      for (const to of m.skills) {
        if (to.id === from.id || !usableAt(to, reel.level, m.reels.length)) continue;
        const c: Ctx = { m, reel, slotIndex, from, to };
        if (fitsCapacity(c)) fit.push(c);
      }
      const toChange = (c: Ctx): Change[] => [{ reelIndex, slotIndex, from: from.id, to: c.to.id }];
      let lowerSteps = lowerDrops.get(fromCost);
      if (canDegrade && lowerSteps === undefined) {
        const drops = [...new Set(usableSkills
          .map((skill) => r1(fromCost - costAt(skill, reel.level)))
          .filter((drop) => drop > 0))].sort((a, b) => a - b);
        const nearest = drops[0] ?? Infinity;
        const hasShiftAtNearest = usableSkills.some((skill) =>
          isShift(skill) && r1(fromCost - costAt(skill, reel.level)) === nearest);
        const extraNormal = hasShiftAtNearest && drops.length > 1 && usableSkills.some((skill) =>
          skill.kind === 'normal' && r1(fromCost - costAt(skill, reel.level)) === drops[1])
          ? drops[1]
          : null;
        lowerSteps = { nearest, extraNormal };
        lowerDrops.set(fromCost, lowerSteps);
      }
      // 直下の段階が移動技なら、その次の段階にある通常技も劣化候補に加える。
      const pool = legacy
        ? fit.filter((c) => {
            const drop = r1(fromCost - costAt(c.to, reel.level));
            return drop <= 0 || (canDegrade &&
              (drop === lowerSteps?.nearest || (drop === lowerSteps?.extraNormal && c.to.kind === 'normal')));
          })
        : fit;
      if (pool.length === 0) return;
      const poolKinds = pool.map((c): ChangeKind => (r1(fromCost - costAt(c.to, reel.level)) > 0 ? 'degrade' : 'up'));
      const poolWeights = pool.map((c) => (legacy ? legacyTargetWeightRules.reduce((w, rule) => w * rule(c), 1) : newTargetWeight(c)));
      const group: Group = {
        weight: canDegrade ? 1 : slotWeight(m, reel, from, byId, legacy),
        shifts: isShift(from) ? 1 : 0,
        kind: 'up',
        pool: pool.map(toChange),
        poolKinds,
        poolWeights,
      };
      groups.push(group);
      if (canDegrade && group.shifts) shiftGroups.push(group);
      else if (canDegrade && from.kind === 'normal') {
        const total = poolWeights.reduce((sum, weight) => sum + weight, 0);
        const degraded = poolWeights.reduce((sum, weight, i) => sum + (poolKinds[i] === 'degrade' ? weight : 0), 0);
        normalDegradeWeight += group.weight * degraded / total;
      }
    });
    if (normalDegradeWeight > 0 && shiftGroups.length) {
      const shiftWeight = shiftGroups.reduce((sum, group) => sum + group.weight, 0);
      const factor = Math.min(1, MAX_SHIFT_TO_DEGRADE_CHANCE * normalDegradeWeight / shiftWeight);
      for (const group of shiftGroups) group.weight *= factor;
    }
  });
  return groups;
}

/** 旧仕様(Lv9以下)でのみ起こる。同一リールの2枠が同時に変化する。移動技を含まない有効な枠組があれば、そのリールの移動技を保護する。片方が良化・片方が劣化し、合計は元のコスト以上かつキャパ以内 */
function doubleGroups(m: Monster, byId: Map<string, Skill>): Group[] {
  const groups: Group[] = [];
  m.reels.forEach((reel, reelIndex) => {
    const rest = r1(reel.capacity - slotCost(reel, m.skills, reel.level));
    if (rest > DEGRADE_MAX_REST) return;
    const targets = m.skills.filter((s) => usableAt(s, reel.level, m.reels.length));
    const reelGroups: Group[] = [];
    for (let i = 0; i < reel.slots.length; i++) {
      for (let j = i + 1; j < reel.slots.length; j++) {
        const a = byId.get(reel.slots[i]);
        const b = byId.get(reel.slots[j]);
        if (!a || !b) continue;
        const pool: Change[][] = [];
        for (const x of targets) {
          if (x.id === a.id || x.id === b.id) continue;
          const da = r1(costAt(x, reel.level) - costAt(a, reel.level));
          if (da === 0) continue;
          for (const y of targets) {
            if (y.id === a.id || y.id === b.id) continue; // 変化前の技(2枠とも)は変化後に選ばれない。x === y は可
            const db = r1(costAt(y, reel.level) - costAt(b, reel.level));
            if (db === 0 || da > 0 === db > 0) continue;
            const net = r1(da + db);
            if (net < 0 || net > rest) continue;
            pool.push([
              { reelIndex, slotIndex: i, from: a.id, to: x.id },
              { reelIndex, slotIndex: j, from: b.id, to: y.id },
            ]);
          }
        }
        if (pool.length === 0) continue;
        reelGroups.push({ weight: 1, kind: 'double', pool, shifts: Number(isShift(a)) + Number(isShift(b)) });
      }
    }
    groups.push(...protectShift(reelGroups));
  });
  return groups;
}
export interface PickOptions {
  legacy: boolean;
  forceDouble?: boolean;
}

export interface WeightedChange {
  set: ChangeSet;
  probability: number;
}

function appendDistribution(groups: Group[], chance: number, add: (set: ChangeSet, probability: number) => void): void {
  const total = groups.reduce((sum, group) => sum + group.weight, 0);
  if (!total || !chance) return;
  for (const group of groups) {
    const weights = group.poolWeights;
    const sum = weights ? weights.reduce((a, b) => a + b, 0) : group.pool.length;
    group.pool.forEach((changes, i) => add(
      { kind: group.poolKinds?.[i] ?? group.kind, changes },
      chance * group.weight / total * (weights?.[i] ?? 1) / sum,
    ));
  }
}

/** 抽選と同じ候補・重みから、1バトルで提案される確率を列挙する。 */
export function changeDistribution(m: Monster, options: PickOptions, aggregate = false): WeightedChange[] {
  const { legacy, forceDouble = false } = options;
  const byId = new Map(m.skills.map((skill) => [skill.id, skill]));
  const doubles = legacy ? doubleGroups(m, byId) : [];
  const results: WeightedChange[] = [];
  const grouped = new Map<string, WeightedChange>();
  const add = (set: ChangeSet, probability: number) => {
    if (!aggregate) { results.push({ set, probability }); return; }
    const changes = set.changes.map((c) => JSON.stringify([c.reelIndex, c.from, c.to])).sort();
    const key = JSON.stringify([set.kind, changes]);
    const previous = grouped.get(key);
    if (previous) previous.probability += probability;
    else { const result = { set, probability }; grouped.set(key, result); results.push(result); }
  };
  if (forceDouble) appendDistribution(doubles, 1, add);
  else {
    const doubleChance = doubles.length ? DOUBLE_CHANCE : 0;
    appendDistribution(doubles, doubleChance, add);
    appendDistribution(singleGroups(m, legacy, byId), 1 - doubleChance, add);
  }
  return results;
}

export function pickChange(m: Monster, { legacy, forceDouble = false }: PickOptions, rng: () => number = Math.random): ChangeSet | null {
  const byId = new Map(m.skills.map((s) => [s.id, s]));
  if (legacy && (forceDouble || rng() < DOUBLE_CHANCE)) {
    const d = draw(doubleGroups(m, byId), rng);
    if (d || forceDouble) return d;
  }
  if (forceDouble) return null;
  return draw(singleGroups(m, legacy, byId), rng);
}

export function applyChange(m: Monster, set: ChangeSet): void {
  for (const c of set.changes) m.reels[c.reelIndex].slots[c.slotIndex] = c.to;
}

export function revertChange(m: Monster, set: ChangeSet): void {
  for (const c of set.changes) m.reels[c.reelIndex].slots[c.slotIndex] = c.from;
}

/** 提案時から対象枠が変わっていないか */
export function isChangeValid(m: Monster, set: ChangeSet): boolean {
  return set.changes.every((c) => m.reels[c.reelIndex]?.slots[c.slotIndex] === c.from);
}

export const CHANGE_LABEL: Record<ChangeKind, string> = { up: '', degrade: '劣化', double: 'ダブル変化' };
