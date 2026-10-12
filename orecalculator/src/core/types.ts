export const SLOTS = 6;
export const MAX_DOWN = 5;

// charge: ターンを消費して上位リールへ移動する技(ためる等)。抽選上は実行される技として扱う
export type SkillKind = 'normal' | 'charge' | 'up' | 'down';

export interface Skill {
  id: string;
  name: string;
  cost: number;
  kind: SkillKind;
  isMiss?: boolean;
  costByLevel?: Record<number, number>; // リール別コスト(未指定のリールは cost)
  fromLevel?: number; // 移動技の発生リール(指定時はそのリールにのみ入れられる)
}

export interface Sample {
  slots: string[];
}

export interface Reel {
  level: number; // 1..4
  capacity: number;
  slots: string[]; // 長さ SLOTS、未入力は ""
  samples: Sample[];
}

export interface Monster {
  id: string;
  name: string;
  skills: Skill[];
  reels: Reel[]; // 長さ = クラス(1..4)
  capacityIsA?: boolean; // ゲーム内でA個体と確認できた場合
}

export const r1 = (n: number): number => Math.round(n * 10) / 10;

export const capacityAt = (capacity: number, stage: number): number =>
  stage === 100 ? capacity : Math.floor((capacity * stage) / 10 + 1e-8) / 10;

export const CAPACITY_RANKS = [
  { rank: 'A', stage: 100 },
  { rank: 'B', stage: 99 },
  { rank: 'C', stage: 98 },
  { rank: 'D', stage: 97 },
  { rank: 'E', stage: 96 },
  { rank: 'F', stage: 95 },
] as const;


/** 技の色(移動系はオレンジ、それ以外はコストで区分) */
export type CostTier = 'gold' | 'silver' | 'bronze' | 'beige';
export type Tier = CostTier | 'shift';
export const costTier = (cost: number): CostTier => (cost >= 4.8 ? 'gold' : cost >= 3.6 ? 'silver' : cost >= 2 ? 'bronze' : 'beige');
export function tierOf(s: Skill, cost: number): Tier {
  return s.kind !== 'normal' ? 'shift' : costTier(cost);
}

export const costAt = (s: Skill, level: number): number => s.costByLevel?.[level] ?? s.cost;



/** 技を level のリールに入れられるか(移動技の発生リール・最上位/最下位の制約) */
export function usableAt(s: Skill, level: number, reelCount: number): boolean {
  if (s.fromLevel !== undefined && s.fromLevel !== level) return false;
  if ((s.kind === 'up' || s.kind === 'charge') && level >= reelCount) return false;
  if (s.kind === 'down' && level === 1) return false;
  return true;
}


/** 表示順: ミス系・低下 → ためる → 通常技 → 上昇 */
export function categoryRank(s: Skill): number {
  if (s.kind === 'normal') return s.isMiss ? 0 : 2;
  return { charge: 1, up: 3, down: 0 }[s.kind];
}

export const byCategory = (a: Skill, b: Skill): number => categoryRank(a) - categoryRank(b);
