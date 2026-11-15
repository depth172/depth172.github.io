import { slotCost, validate } from './calc.ts';
import { applyChange, changeDistribution, type ChangeSet } from './change.ts';
import { capacityRankOf, SLOTS, withActualCapacities, type Monster } from './types.ts';
import { changeKey, findMissRoute } from './miss-route.ts';
import { recommendedSequence } from './miss-sequence.ts';

export interface MissPlanOptions { reelIndex: number; target: number }
export interface MissPlanLimits { maxStates?: number; maxEdges?: number; maxElapsedMs?: number }
export interface MissPlanChoice { set: ChangeSet; probability: number; accept: boolean; next: number }
export interface MissPlanPolicy { slots: string[][]; accepted: number; expectedBattles: number; choices: MissPlanChoice[] }
export interface MissPlanRoute { expectedBattles: number; policies: MissPlanPolicy[] }
export interface MissPlanProgress { expanded: number; states: number; elapsedMs: number; lower: number; upper: number | null }
export type MissPlanResult =
  | { status: 'ok'; expectedBattles: number; lower: number; upper: number; policies: (MissPlanPolicy | null)[]; route?: MissPlanRoute | null }
  | { status: 'limit'; message: string; progress: MissPlanProgress; route: MissPlanRoute | null }
  | { status: 'unreachable' | 'invalid'; message: string };

interface Edge { next: number; probability: number; set: ChangeSet }
interface Node { monster: Monster; accepted: number; edges: Edge[] | null; lower: number; upper: number; parents: Set<number> }
const MAX_STATES = 20000;
const MAX_EDGES = 250000;
const MAX_ELAPSED_MS = 15000;
const SOLVE_SWEEPS = 30;
const EXPANSION_BATCH = 32;
const TOLERANCE = 1e-6;

/** 最初の10回の採用は旧仕様、11回目からは新仕様。拒否は状態を変えない。 */
export function planMiss(input: Monster, options: MissPlanOptions, onProgress?: (progress: MissPlanProgress) => void, limits: MissPlanLimits = {}): MissPlanResult {
  const maxStates = limits.maxStates ?? MAX_STATES;
  const maxEdges = limits.maxEdges ?? MAX_EDGES;
  const maxElapsedMs = limits.maxElapsedMs ?? MAX_ELAPSED_MS;
  if (!Number.isInteger(options.reelIndex) || !input.reels[options.reelIndex] ||
      !Number.isInteger(options.target) || options.target < 1 || options.target > SLOTS) {
    return { status: 'invalid', message: '対象リールと目標ミス枠数を確認してください。' };
  }
  if (!capacityRankOf(input)) return { status: 'invalid', message: 'キャパシティランクを指定してください。' };
  if (input.reels.some((reel) => !Array.isArray(reel.initialSlots) || reel.initialSlots.length !== SLOTS)) {
    return { status: 'invalid', message: 'すべてのリールの初期配置を入力してください。' };
  }
  const monster = withActualCapacities(input);
  monster.reels = monster.reels.map((reel) => ({ ...reel, slots: [...reel.initialSlots!].sort() }));
  const errors = validate(monster);
  if (errors.length) return { status: 'invalid', message: errors.join(' / ') };
  const overCapacity = monster.reels.find((reel) => slotCost(reel, monster.skills, reel.level) > reel.capacity);
  if (overCapacity) return { status: 'invalid', message: `★${overCapacity.level}の初期配置が指定ランクのキャパを超えています。` };
  const misses = new Set(monster.skills.filter((skill) => skill.isMiss).map((skill) => skill.id));
  if (!misses.size) return { status: 'invalid', message: 'ミスとして扱う技を設定してください。' };
  const done = (m: Monster) => m.reels[options.reelIndex].slots.filter((id) => misses.has(id)).length >= options.target;
  if (done(monster)) return { status: 'ok', expectedBattles: 0, lower: 0, upper: 0, policies: [{ slots: monster.reels.map((r) => r.slots), accepted: 0, expectedBattles: 0, choices: [] }] };
  const keyOf = (m: Monster, accepted: number) => JSON.stringify([accepted, m.reels.map((r) => r.slots)]);
  const nodes: Node[] = [{ monster, accepted: 0, edges: null, lower: 1, upper: Infinity, parents: new Set() }];
  const indices = new Map<string, number>([[keyOf(monster, 0), 0]]);
  // 上下限はそれぞれ遷移先の同じ側の値だけに依存する。
  const dirty = new Map<number, number>();
  const LOWER = 1, UPPER = 2;
  const started = Date.now();
  let lastProgress = 0;
  let expanded = 0;
  let edgeCount = 0;

  const progress = (): MissPlanProgress => ({
    expanded, states: nodes.length, elapsedMs: Date.now() - started,
    lower: Math.min(nodes[0].lower, nodes[0].upper), upper: Number.isFinite(nodes[0].upper) ? nodes[0].upper : null,
  });
  const findRoute = (): MissPlanRoute | null => {
    const found = findMissRoute(monster, options.reelIndex, options.target, 2000);
    return found ? {
      expectedBattles: found.expectedBattles,
      policies: found.steps.map((step, index): MissPlanPolicy => ({
        slots: step.monster.reels.map((reel) => reel.slots),
        accepted: step.accepted,
        expectedBattles: step.expectedBattles,
        choices: step.outcomes.map(({ set, probability }) => {
          const accept = step.acceptedKeys.includes(changeKey(set));
          return { set, probability, accept, next: index + 1 === found.steps.length ? -1 : index + 1 };
        }),
      })),
    } : null;
  };
  const limit = (message: string): MissPlanResult => {
    const route = findRoute();
    const report = progress();
    if (route && (report.upper === null || route.expectedBattles < report.upper)) report.upper = route.expectedBattles;
    return { status: 'limit', message, progress: report, route };
  };
  const value = (edge: Edge, bound: 'lower' | 'upper') => edge.next < 0 ? 0 : nodes[edge.next][bound];

  // 各提案の採用・拒否を選ぶと、採用する確率の合計で待ち時間を除算できる。
  function update(node: Node, bound: 'lower' | 'upper'): number {
    if (!node.edges) return node[bound];
    const candidates = node.edges.map((edge) => ({ p: edge.probability, v: value(edge, bound) }))
      .filter((entry) => Number.isFinite(entry.v))
      .sort((a, b) => a.v - b.v);
    let chance = 0;
    let weighted = 0;
    let best = Infinity;
    for (const candidate of candidates) {
      chance += candidate.p;
      weighted += candidate.p * candidate.v;
      best = Math.min(best, (1 + weighted) / chance);
    }
    return best;
  }
  function relax(): void {
    for (let sweep = 0; sweep < SOLVE_SWEEPS; sweep++) {
      if (!dirty.size) break;
      let changed = false;
      // 従来の逆順走査と同じ順序で、値の変化が伝わる親だけを再評価する。
      const queue: number[] = [];
      const queued = new Map<number, number>();
      const push = (index: number, bounds: number) => {
        const previous = queued.get(index);
        if (previous !== undefined) { queued.set(index, previous | bounds); return; }
        queued.set(index, bounds);
        let i = queue.length;
        queue.push(index);
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          if (queue[parent] >= index) break;
          queue[i] = queue[parent];
          i = parent;
        }
        queue[i] = index;
      };
      for (const [index, bounds] of dirty) push(index, bounds);
      dirty.clear();
      while (queue.length) {
        const index = queue[0];
        const last = queue.pop()!;
        if (queue.length) {
          let i = 0;
          while (i * 2 + 1 < queue.length) {
            let child = i * 2 + 1;
            if (child + 1 < queue.length && queue[child + 1] > queue[child]) child++;
            if (queue[child] <= last) break;
            queue[i] = queue[child];
            i = child;
          }
          queue[i] = last;
        }
        const bounds = queued.get(index)!;
        queued.delete(index);
        const node = nodes[index];
        if (!node.edges) continue;
        let updated = 0;
        if (bounds & LOWER) {
          const lower = update(node, 'lower');
          if (lower > node.lower) { changed ||= lower - node.lower > 1e-10; node.lower = lower; updated |= LOWER; }
        }
        if (bounds & UPPER) {
          const upper = update(node, 'upper');
          if (upper < node.upper) { changed ||= node.upper - upper > 1e-10; node.upper = upper; updated |= UPPER; }
        }
        if (updated) {
          for (const parent of node.parents) {
            if (parent < index) push(parent, updated);
            else dirty.set(parent, (dirty.get(parent) ?? 0) | updated);
          }
        }
      }
      if (!changed) break;
    }
  }
  const frontier: { index: number; score: number }[] = [];
  const frontierSeen = new Set<number>();
  let frontierExpanded: { index: number; score: number } | null = null;
  let fallbackIndex = 0;
  function pushFrontier(entry: { index: number; score: number }): void {
    let i = frontier.length;
    frontier.push(entry);
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (frontier[parent].score >= entry.score) break;
      frontier[i] = frontier[parent];
      i = parent;
    }
    frontier[i] = entry;
  }
  function popFrontier(): { index: number; score: number } {
    const first = frontier[0];
    const last = frontier.pop()!;
    if (frontier.length) {
      let i = 0;
      while (i * 2 + 1 < frontier.length) {
        let child = i * 2 + 1;
        if (child + 1 < frontier.length && frontier[child + 1].score > frontier[child].score) child++;
        if (frontier[child].score <= last.score) break;
        frontier[i] = frontier[child];
        i = child;
      }
      frontier[i] = last;
    }
    return first;
  }
  function resetFrontier(): void {
    // 上下限の更新で方策が変わりうるため、優先度を持ち越さない。
    frontier.length = 0;
    frontierSeen.clear();
    frontierExpanded = null;
    pushFrontier({ index: 0, score: 1 });
  }
  function addFrontierChildren(current: { index: number; score: number }): void {
    const node = nodes[current.index];
    if (!node.edges) return;
    const accepted = node.edges.filter((edge) => edge.next >= 0 && value(edge, 'lower') < node.lower);
    const chance = accepted.reduce((sum, edge) => sum + edge.probability, 0);
    if (!chance) return;
    for (const edge of accepted) {
      if (!frontierSeen.has(edge.next)) pushFrontier({ index: edge.next, score: current.score * edge.probability / chance });
    }
  }
  function chooseFrontier(): number | undefined {
    // 方策が変わらない間は、前回選んだ状態から優先探索を再開する。
    if (frontierExpanded) {
      addFrontierChildren(frontierExpanded);
      frontierExpanded = null;
    }
    while (frontier.length) {
      const current = popFrontier();
      if (frontierSeen.has(current.index)) continue;
      frontierSeen.add(current.index);
      if (!nodes[current.index].edges) {
        frontierExpanded = current;
        return current.index;
      }
      addFrontierChildren(current);
    }
    while (fallbackIndex < nodes.length && nodes[fallbackIndex].edges) fallbackIndex++;
    return fallbackIndex < nodes.length ? fallbackIndex : undefined;
  }

  let sinceRelax = EXPANSION_BATCH;
  while (true) {
    if (sinceRelax >= EXPANSION_BATCH) { relax(); resetFrontier(); sinceRelax = 0; }
    const report = progress();
    if (onProgress && report.elapsedMs - lastProgress >= 250) { onProgress(report); lastProgress = report.elapsedMs; }
    const root = nodes[0];
    if (Number.isFinite(root.upper) && root.upper - root.lower <= TOLERANCE * Math.max(1, root.upper)) {
      const policies = nodes.map((node): MissPlanPolicy | null => Number.isFinite(node.upper) && node.edges ? ({
        slots: node.monster.reels.map((reel) => reel.slots),
        accepted: node.accepted,
        expectedBattles: node.upper,
        choices: node.edges.map((edge) => ({
          set: edge.set, probability: edge.probability, next: edge.next,
          accept: value(edge, 'upper') < node.upper,
        })),
      }) : null);
      const route = recommendedSequence(policies, options.reelIndex) ? undefined : findRoute();
      return { status: 'ok', expectedBattles: root.upper, lower: Math.min(root.lower, root.upper), upper: root.upper, policies, route };
    }
    const next = chooseFrontier();
    if (next === undefined) {
      if (sinceRelax > 0) { sinceRelax = EXPANSION_BATCH; continue; }
      if (!Number.isFinite(root.upper)) {
        const seen = new Set<number>([0]);
        const pending = [0];
        let hasGoal = false;
        for (let i = 0; i < pending.length && !hasGoal; i++) {
          for (const edge of nodes[pending[i]].edges ?? []) {
            if (edge.next < 0) { hasGoal = true; break; }
            if (!seen.has(edge.next)) { seen.add(edge.next); pending.push(edge.next); }
          }
        }
        if (!hasGoal) return { status: 'unreachable', message: '目標ミス枠数に到達できる変化経路がありません。' };
      }
      if (report.elapsedMs >= maxElapsedMs) return limit('期待値の上下限が収束しなかったため計算を中止しました。');
      sinceRelax = EXPANSION_BATCH;
      continue;
    }
    if (report.elapsedMs >= maxElapsedMs) return limit('計算時間の上限に達したため中止しました。');
    const node = nodes[next];
    const outcomes = changeDistribution(node.monster, { legacy: node.accepted < 10 }, true);
    const nextAccepted = Math.min(10, node.accepted + 1);
    const edges: Edge[] = [];
    for (const { set, probability } of outcomes) {
      // 対象外の提案は拒否し、その確率を残して待機回数に反映する。
      if (probability <= 0 || set.changes.some((change) => change.reelIndex !== options.reelIndex)) continue;
      const nextMonster = { ...node.monster, reels: node.monster.reels.map((r) => ({ ...r, slots: [...r.slots] })) };
      applyChange(nextMonster, set);
      for (const reel of nextMonster.reels) reel.slots.sort();
      let dest = -1;
      if (!done(nextMonster)) {
        const key = keyOf(nextMonster, nextAccepted);
        const found = indices.get(key);
        if (found === undefined) {
          if (nodes.length >= maxStates) return limit(`状態数が上限 ${maxStates} に達したため中止しました。`);
          dest = nodes.length;
          indices.set(key, dest);
          nodes.push({ monster: nextMonster, accepted: nextAccepted, edges: null, lower: 1, upper: Infinity, parents: new Set() });
        } else dest = found;
      }
      if (++edgeCount > maxEdges) return limit(`変化候補数が上限 ${maxEdges} に達したため中止しました。`);
      edges.push({ next: dest, probability, set });
    }
    node.edges = edges;
    for (const edge of edges) if (edge.next >= 0) nodes[edge.next].parents.add(next);
    dirty.set(next, LOWER | UPPER);
    expanded++;
    sinceRelax++;
  }
}
