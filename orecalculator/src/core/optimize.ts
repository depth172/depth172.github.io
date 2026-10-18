import { defaultMax } from './enumerate.ts';
import { CAPACITY_RANKS, MAX_DOWN, SLOTS, capacityAt, costAt, r1, usableAt, type Monster, type Skill } from './types.ts';

interface Candidate {
  t: number; // 狙う技の枠数
  u: number; // 上昇の枠数
  d: number; // 低下の枠数
  cost: number;
  ids: string[];
  nFill: number; // 穴埋め枠数(ids 末尾)
  fillers: Entry[]; // 優先度順の穴埋め候補
  c: number; // ためるの枠数(穴埋め確定後に設定)
}

export interface OptimizeOptions {
  target: string;
  start?: number; // 開始リール(★の数、既定1)
  turns?: number; // 評価するターン数(既定1)。リールは実行された技のリールを次ターンも引き継ぐ
  max?: Record<string, number>; // 技ごとの最大枠数(狙う技の既定は6、他は構成シミュレーションの既定)
}

export interface RankResult {
  rank: string;
  stage: number;
  probability: number | null; // 1ターン目の確率。実現不能なら null
  expected: number | null; // turns ターンの期待回数
  perTurn: number[]; // ターンごとの確率
  layouts: string[][] | null; // リールごとの技ID(★1から順)
}

interface Entry {
  id: string;
  cost: number;
  cap: number;
  pri?: number;
}

/** 穴埋め枠を、キャパに収まる範囲で ためる > 通常技 > ミス系 の優先度で置き換える */
function upgradeFill(c: Candidate, capacity: number): string[] {
  const base = c.ids.slice(0, c.ids.length - c.nFill);
  const minCost = Math.min(...c.fillers.map((f) => f.cost));
  let used = r1(c.cost - c.ids.slice(c.ids.length - c.nFill).reduce((a, id) => a + (c.fillers.find((f) => f.id === id)?.cost ?? 0), 0));
  const fill: string[] = [];
  for (let i = 0; i < c.nFill; i++) {
    const rest = c.nFill - i - 1;
    const pick = c.fillers.find((f) => r1(used + f.cost + rest * minCost) <= capacity) ?? c.fillers.find((f) => f.cost === minCost)!;
    fill.push(pick.id);
    used = r1(used + pick.cost);
  }
  return [...base, ...fill];
}

/** コストの安い順に、最大枠数の範囲内で n 枠選ぶ。足りなければ null */
function pickCheapest(list: Entry[], n: number): { ids: string[]; cost: number } | null {
  const ids: string[] = [];
  let cost = 0;
  for (const e of [...list].sort((a, b) => a.cost - b.cost)) {
    for (let i = 0; i < e.cap && ids.length < n; i++) {
      ids.push(e.id);
      cost += e.cost;
    }
  }
  return ids.length === n ? { ids, cost } : null;
}

/** リール1枚について、(狙う技, 上昇, 低下)の枠数の組ごとに最もコストの低い構成を作る */
function reelCandidates(m: Monster, level: number, opt: OptimizeOptions): Candidate[] {
  const usable = m.skills.filter((s) => usableAt(s, level, m.reels.length));
  const cap = (s: Skill) => opt.max?.[s.id] ?? defaultMax(s.kind);
  const entry = (s: Skill): Entry => ({ id: s.id, cost: costAt(s, level), cap: cap(s) });

  const target = usable.find((s) => s.id === opt.target);
  const targetCost = target ? costAt(target, level) : 0;
  const targetCap = target ? (opt.max?.[target.id] ?? SLOTS) : 0;
  const ups = usable.filter((s) => s.kind === 'up').map(entry);
  const downs = usable.filter((s) => s.kind === 'down').map(entry);
  const fillers = usable
    .filter((s) => (s.kind === 'normal' || s.kind === 'charge') && s.id !== opt.target)
    .map((s) => ({ ...entry(s), cap: SLOTS, pri: s.kind === 'charge' ? 0 : s.isMiss ? 2 : 1 }))
    .sort((a, b) => a.pri - b.pri || b.cost - a.cost);

  const result: Candidate[] = [];
  for (let t = 0; t <= Math.min(SLOTS, targetCap); t++) {
    for (let u = 0; t + u <= SLOTS; u++) {
      const up = pickCheapest(ups, u);
      if (!up) continue;
      for (let d = 0; t + u + d <= SLOTS; d++) {
        const down = pickCheapest(downs, d);
        if (!down) continue;
        const fill = pickCheapest(fillers, SLOTS - t - u - d);
        if (!fill) continue;
        result.push({
          t,
          u,
          d,
          cost: r1(t * targetCost + up.cost + down.cost + fill.cost),
          ids: [...Array<string>(t).fill(opt.target), ...up.ids, ...down.ids, ...fill.ids],
          nFill: SLOTS - t - u - d,
          fillers,
          c: 0,
        });
      }
    }
  }
  return result;
}

/** 開始リール r から1ターンで狙う技が出る確率と、次ターンの開始リールの分布を求める */
function turnStep(sel: Candidate[], r0: number): { hit: number; next: number[] } {
  const n = sel.length;
  const next = new Array<number>(n).fill(0);
  let hit = 0;
  const walk = (r: number, j: number, w: number) => {
    const { t, u, d, c } = sel[r];
    hit += (w * t) / SLOTS;
    next[r] += (w * (SLOTS - u - d - c)) / SLOTS; // 狙う技・通常技・ミス系は同じリールに留まる
    if (c) next[Math.min(r + 1, n - 1)] += (w * c) / SLOTS;
    if (u && r + 1 < n) walk(r + 1, j, (w * u) / SLOTS);
    if (d) {
      if (j + 1 >= MAX_DOWN) next[0] += (w * d) / SLOTS;
      else walk(0, j + 1, (w * d) / SLOTS);
    }
  };
  walk(r0, 0, 1);
  return { hit, next };
}

/** ★1開始から turns ターンの、ターンごとの狙う技の実行確率 */
function perTurn(sel: Candidate[], turns: number, start = 0): number[] {
  const steps = sel.map((_, r) => turnStep(sel, r));
  let dist = new Array<number>(sel.length).fill(0);
  dist[start] = 1;
  const out: number[] = [];
  for (let k = 0; k < turns; k++) {
    let p = 0;
    const nd = new Array<number>(sel.length).fill(0);
    dist.forEach((w, r) => {
      if (!w) return;
      p += w * steps[r].hit;
      steps[r].next.forEach((x, q) => (nd[q] += w * x));
    });
    out.push(p);
    dist = nd;
  }
  return out;
}

/** 各ランクのキャパ内で、★1開始から turns ターンの狙う技の期待回数が最大になる全リールの組み合わせを求める */
export function optimizeForTarget(m: Monster, opt: OptimizeOptions): RankResult[] {
  const all = m.reels.map((r) => reelCandidates(m, r.level, opt));
  const turns = Math.max(1, Math.floor(opt.turns ?? 1));
  const start = Math.min(m.reels.length, Math.max(1, Math.floor(opt.start ?? 1))) - 1;
  const byId = new Map(m.skills.map((s) => [s.id, s]));

  return CAPACITY_RANKS.map(({ rank, stage }) => {
    const lists = all.map((cands, i) => {
      const capacity = capacityAt(m.reels[i].capacity, stage);
      // 同じ(上昇, 低下)なら狙う技が多いほど有利なので、成立する最大の枠数だけ残す
      const best = new Map<string, Candidate>();
      for (const c of cands) {
        if (c.cost > capacity) continue;
        const key = `${c.u}:${c.d}`;
        const cur = best.get(key);
        if (!cur || c.t > cur.t || (c.t === cur.t && c.cost < cur.cost)) best.set(key, c);
      }
      // 穴埋めを確定させ、ためるの枠数を数える
      return [...best.values()].map((c) => {
        const ids = upgradeFill(c, capacity);
        const cost = r1(ids.reduce((a, id) => a + costAt(byId.get(id)!, m.reels[i].level), 0));
        return { ...c, ids, cost, c: ids.filter((id) => byId.get(id)?.kind === 'charge').length };
      });
    });
    if (lists.some((l) => l.length === 0)) return { rank, stage, probability: null, expected: null, perTurn: [], layouts: null };

    let bestE = -1;
    let bestKey: number[] = [-Infinity, -Infinity, -Infinity];
    let bestSel: Candidate[] | null = null;
    const sel: Candidate[] = [];
    const dfs = (i: number) => {
      if (i === lists.length) {
        const e = perTurn(sel, turns, start).reduce((a, b) => a + b, 0);
        const cost = sel.reduce((a, c) => a + c.cost, 0);
        // 同率なら、技が多く・低下が少なく・コストが高い構成を優先(到達しないリールや他要因で移動した場合にも強い)
        const key = [sel.reduce((a, c) => a + c.t, 0), -sel.reduce((a, c) => a + c.d, 0), cost];
        const lex = key.findIndex((v, k) => v !== bestKey[k]);
        const better = e > bestE + 1e-12 || (Math.abs(e - bestE) <= 1e-12 && lex >= 0 && key[lex] > bestKey[lex]);
        if (better) {
          bestE = e;
          bestKey = key;
          bestSel = [...sel];
        }
        return;
      }
      for (const c of lists[i]) {
        sel[i] = c;
        dfs(i + 1);
      }
    };
    dfs(0);
    const chosen = bestSel as Candidate[] | null;
    const pt = chosen ? perTurn(chosen, turns, start) : [];
    return { rank, stage, probability: pt[0] ?? null, expected: bestE, perTurn: pt, layouts: chosen ? chosen.map((c) => c.ids) : null };
  });
}
