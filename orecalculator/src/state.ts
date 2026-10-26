import type { ChangeSet } from './core/change.ts';
import type { EnumResult } from './core/enumerate.ts';
import type { RankResult } from './core/optimize.ts';
import { load } from './core/store.ts';
import type { CAPACITY_RANKS, Monster } from './core/types.ts';

export type Tab = 'reels' | 'monster';
export type SubTab = 'probability' | 'change' | 'best';

export interface SimState {
  level: number;
  rank: (typeof CAPACITY_RANKS)[number]['rank'];
  min: Record<string, number>;
  max: Record<string, number>;
  result: EnumResult | null;
}

export interface ProbViewState {
  start: number;
  turns: number;
}

export interface BestState {
  target: string;
  prioritySkill: string;
  start: number;
  turns: number;
  earlyTurnWeighting: boolean;
  result: RankResult[] | null;
}

export interface ChangeEntry {
  monsterId: string;
  set: ChangeSet;
}

export const store = load();
export const sim: SimState = { level: 1, rank: 'A', min: {}, max: {}, result: null };
export const probView: ProbViewState = { start: 1, turns: 5 };
export const best: BestState = { target: '', prioritySkill: '', start: 1, turns: 3, earlyTurnWeighting: false, result: null };
export const ui: { activeTab: Tab; activeSubTab: SubTab; changeMsg: string; forceDouble: boolean; pending: ChangeEntry | null } = {
  activeTab: 'reels',
	activeSubTab: 'probability',
  changeMsg: '',
  forceDouble: false,
  pending: null,
};
// 再描画で details が閉じないよう開閉状態を保持する
export const openSet = new Set<string>();

export const cur = (): Monster => store.monsters.find((m) => m.id === store.currentId) ?? store.monsters[0];
export const changeLogOf = (id: string): ChangeSet[] => store.changeLogs?.[id] ?? [];
export const pressCountOf = (id: string): number => store.pressCounts?.[id] ?? 0;
