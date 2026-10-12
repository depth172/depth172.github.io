import type { Monster, Reel } from './types.ts';
import { SLOTS } from './types.ts';

const KEY = 'orecalculator:v1';

export interface Store {
  monsters: Monster[];
  currentId: string;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newReel(level: number): Reel {
  return { level, capacity: 0, slots: new Array<string>(SLOTS).fill(''), samples: [] };
}

export function newMonster(name = '新しいモンスター', classLevel = 1): Monster {
  const m: Monster = { id: uid(), name, skills: [], reels: Array.from({ length: classLevel }, (_, i) => newReel(i + 1)) };
  syncShiftSkills(m);
  return m;
}

/** ★n→★n+1 のリール上昇コスト(モンスター共通)。実値は仕様に合わせて更新する */
export const DEFAULT_UP_COST: Record<number, number> = { 1: 3, 2: 4, 3: 5 };

/** 「ためる」のリール別コスト(モンスター共通) */
export const DEFAULT_CHARGE_COST: Record<number, number> = { 1: 1, 2: 1.4, 3: 1.8 };

const STAR = (n: number) => '★'.repeat(n);

/** クラスに応じて ★n→★n+1 の上昇技を補い、不要になったものを削除する */
export function syncShiftSkills(m: Monster): void {
  const n = m.reels.length;
  const removed = new Set(m.skills.filter((s) => s.kind === 'up' && s.fromLevel !== undefined && s.fromLevel >= n).map((s) => s.id));
  if (removed.size > 0) {
    m.skills = m.skills.filter((s) => !removed.has(s.id));
    const clear = (arr: string[]) => arr.forEach((v, j) => { if (removed.has(v)) arr[j] = ''; });
    m.reels.forEach((r) => { clear(r.slots); r.samples.forEach((s) => clear(s.slots)); });
  }
  for (let lv = 1; lv < n; lv++) {
    if (m.skills.some((s) => s.kind === 'up' && s.fromLevel === lv)) continue;
    m.skills.push({ id: uid(), name: `${STAR(lv)}→${STAR(lv + 1)}`, cost: DEFAULT_UP_COST[lv] ?? 0, kind: 'up', fromLevel: lv });
  }
  if (n >= 2 && !m.skills.some((s) => s.kind === 'charge')) {
    m.skills.push({ id: uid(), name: 'ためる', cost: DEFAULT_CHARGE_COST[1], kind: 'charge', costByLevel: { ...DEFAULT_CHARGE_COST } });
  }
}

export function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (Array.isArray(s.monsters) && s.monsters.length > 0) return s;
    }
  } catch {
    // 破損データは無視して初期化
  }
  const m = newMonster();
  return { monsters: [m], currentId: m.id };
}

export function save(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function exportMonster(m: Monster): string {
  return JSON.stringify(m, null, 2);
}

export function importMonster(json: string): Monster {
  const m = JSON.parse(json) as Monster;
  if (typeof m.name !== 'string' || !Array.isArray(m.skills) || !Array.isArray(m.reels) || m.reels.length < 1 || m.reels.length > 4) {
    throw new Error('モンスターデータの形式が正しくありません');
  }
  return { ...m, id: uid() };
}

