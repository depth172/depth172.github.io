import { MAX_DOWN, SLOTS, costAt, r1, usableAt, type Monster, type Reel, type Skill } from './types.ts';

export function slotCost(reel: Pick<Reel, 'slots'>, skills: Skill[], level: number): number {
  const byId = new Map(skills.map((s) => [s.id, s]));
  return r1(reel.slots.reduce((sum, id) => sum + (byId.has(id) ? costAt(byId.get(id)!, level) : 0), 0));
}

/** リール構成の入力不備を返す。空なら計算可能。 */
export function validate(monster: Monster): string[] {
  const errors: string[] = [];
  const byId = new Map(monster.skills.map((s) => [s.id, s]));
  const top = monster.reels.length;
  for (const reel of monster.reels) {
    const label = `★${reel.level}`;
    if (reel.slots.length !== SLOTS || reel.slots.some((id) => !byId.has(id))) {
      errors.push(`${label}: 6枠すべてに技を入れてください`);
      continue;
    }
    for (const id of reel.slots) {
      const s = byId.get(id)!;
      if (!usableAt(s, reel.level, top)) {
        const msg = `${label}: 技(${s.name})はこのリールには入れられません`;
        if (!errors.includes(msg)) errors.push(msg);
      }
    }
  }
  return errors;
}

export interface CalcResult {
  bySkill: Map<string, number>; // 実行される技(通常・ミス・ためる)ID -> 確率
  dropMiss: number; // 低下5回によるミス
}

/**
 * 開始リール startLevel から1ターンで実行される技の確率分布。
 * up は回数に含めず、down が MAX_DOWN 回選ばれた時点でミス。
 * charge(ためる)はターンを消費する技なので、実行される技として扱う。
 */
export function calc(monster: Monster, startLevel: number): CalcResult {
  const byId = new Map(monster.skills.map((s) => [s.id, s]));
  const memo = new Map<string, CalcResult>();

  const f = (level: number, downs: number): CalcResult => {
    const key = `${level}:${downs}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const res: CalcResult = { bySkill: new Map(), dropMiss: 0 };
    const reel = monster.reels[level - 1];
    const w = 1 / SLOTS;
    const add = (sub: CalcResult) => {
      for (const [id, p] of sub.bySkill) res.bySkill.set(id, (res.bySkill.get(id) ?? 0) + p * w);
      res.dropMiss += sub.dropMiss * w;
    };
    for (const id of reel.slots) {
      const s = byId.get(id)!;
      if (s.kind === 'normal' || s.kind === 'charge') {
        res.bySkill.set(id, (res.bySkill.get(id) ?? 0) + w);
      } else if (s.kind === 'up') {
        add(f(level + 1, downs));
      } else if (downs + 1 >= MAX_DOWN) {
        res.dropMiss += w;
      } else {
        add(f(1, downs + 1));
      }
    }
    memo.set(key, res);
    return res;
  };
  return f(startLevel, 0);
}
