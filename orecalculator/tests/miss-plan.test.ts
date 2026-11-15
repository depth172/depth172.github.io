import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyChange, changeDistribution, pickChange } from '../src/core/change.ts';
import { planMiss, type MissPlanChoice, type MissPlanPolicy } from '../src/core/miss-plan.ts';
import { exportMonster, importMonster, syncShiftSkills } from '../src/core/store.ts';
import { withActualCapacities, type Monster } from '../src/core/types.ts';
import { recommendedSequence } from '../src/core/miss-sequence.ts';
import { extendTransitions, type TransitionHistory } from '../src/core/miss-transitions.ts';
import { missPlanSamples, renderMissPlan } from '../src/views/miss-plan.ts';

function monster(): Monster {
  return { id: 'm', name: 'test', capacityIsA: true,
    skills: [{ id: 'a', name: 'a', kind: 'normal', cost: 0 }, { id: 'm', name: 'miss', kind: 'normal', cost: 0, isMiss: true }],
    reels: [{ level: 1, capacity: 1, samples: [], slots: Array(6).fill('a'), initialSlots: Array(6).fill('a') }] };
}

test('期待バトル回数は拒否も考慮する', () => {
  const m = monster();
  const one = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(one.status, 'ok');
  if (one.status === 'ok') assert.ok(Math.abs(one.expectedBattles - 1) < 1e-8);
  const two = planMiss(m, { reelIndex: 0, target: 2 });
  assert.equal(two.status, 'ok');
  if (two.status === 'ok') {
    assert.ok(Math.abs(two.expectedBattles - 2.2) < 1e-8, `${two.expectedBattles}`);
    const next = two.policies[0]!.choices[0].next;
    assert.equal(two.policies[next]!.choices.filter((choice) => !choice.accept).length, 1);
    assert.ok(Math.abs(two.policies[next]!.choices.find((choice) => !choice.accept)!.probability - 1 / 6) < 1e-8);
  }
});

test('未設定と到達不能を区別する', () => {
  const m = monster();
  delete m.reels[0].initialSlots;
  assert.equal(planMiss(m, { reelIndex: 0, target: 1 }).status, 'invalid');
  m.reels[0].initialSlots = Array(6).fill('a');
  m.skills[1].cost = 2;
  assert.equal(planMiss(m, { reelIndex: 0, target: 1 }).status, 'unreachable');
});

test('列挙した変化確率は既存の抽選と一致する', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  for (const legacy of [true, false]) {
    const distribution = changeDistribution(m, { legacy });
    assert.ok(Math.abs(distribution.reduce((n, item) => n + item.probability, 0) - 1) < 1e-10);
    const expected = distribution.filter((entry) => entry.set.changes[0].to === 'm').reduce((n, entry) => n + entry.probability, 0);
    let seed = 123456789;
    const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    let count = 0;
    const runs = 30000;
    for (let i = 0; i < runs; i++) if (pickChange(m, { legacy }, rng)?.changes[0].to === 'm') count++;
    assert.ok(Math.abs(count / runs - expected) < 0.015, `${legacy}: ${count / runs} vs ${expected}`);
  }
});

test('Lv9以下の同コスト変化は低重みを適用せず、劣化と色の重みは維持する', () => {
  const m = monster();
  m.skills = [
    { id: 'from', name: 'from', kind: 'normal', cost: 3.5 },
    { id: 'same', name: 'same', kind: 'normal', cost: 3.5 },
    { id: 'higher', name: 'higher', kind: 'normal', cost: 3.6 },
    { id: 'lower', name: 'lower', kind: 'normal', cost: 3.4 },
  ];
  m.reels[0].slots = Array(6).fill('from');
  m.reels[0].capacity = 22;
  const outcomes = changeDistribution(m, { legacy: true, forceDouble: false });
  const chance = (to: string) => outcomes
    .filter(({ set }) => set.kind !== 'double' && set.changes[0].to === to)
    .reduce((sum, item) => sum + item.probability, 0);
  const same = chance('same');
  assert.ok(same > 0);
  assert.ok(Math.abs(chance('higher') / same - 2) < 1e-12);
  assert.ok(Math.abs(chance('lower') / same - 0.1) < 1e-12);
});


test('ダブル変化の発生確率と抽選が一致する', () => {
  const m = monster();
  m.skills = [
    { id: 'a', name: 'a', kind: 'normal', cost: 1 },
    { id: 'b', name: 'b', kind: 'normal', cost: 2 },
    { id: 'c', name: 'c', kind: 'normal', cost: 3 },
    { id: 'd', name: 'd', kind: 'normal', cost: 0 },
  ];
  m.reels[0].slots = ['a', 'a', 'a', 'b', 'b', 'b'];
  m.reels[0].capacity = 10;
  const outcomes = changeDistribution(m, { legacy: true });
  const doubleChance = outcomes.filter((entry) => entry.set.kind === 'double').reduce((n, entry) => n + entry.probability, 0);
  assert.ok(Math.abs(doubleChance - 0.1) < 1e-10);
  assert.ok(Math.abs(outcomes.reduce((n, entry) => n + entry.probability, 0) - 1) < 1e-10);
  let seed = 78;
  const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  let doubles = 0;
  const runs = 20000;
  for (let i = 0; i < runs; i++) if (pickChange(m, { legacy: true }, rng)?.kind === 'double') doubles++;
  assert.ok(Math.abs(doubles / runs - doubleChance) < 0.01);
});

test('ダブル変化の移動保護は有効な枠組をリールごとに判定する', () => {
  const m = monster();
  m.skills = [
    { id: 'a', name: 'a', kind: 'normal', cost: 1 },
    { id: 'b', name: 'b', kind: 'normal', cost: 2 },
    { id: 'c', name: 'c', kind: 'normal', cost: 3 },
    { id: 'd', name: 'd', kind: 'normal', cost: 0 },
    { id: 's', name: 's', kind: 'charge', cost: 2 },
  ];
  m.reels[0].slots = ['a', 'b', 's', 's', 's', 's'];
  m.reels[0].capacity = 11;
  m.reels.push(
    { level: 2, capacity: 11, samples: [], slots: ['a', 's', 's', 's', 's', 's'] },
    { level: 3, capacity: 30, samples: [], slots: Array(6).fill('c') },
  );
  const outcomes = changeDistribution(m, { legacy: true, forceDouble: true });
  const groupChance = (reelIndex: number, first: number, second: number) => outcomes
    .filter(({ set }) => set.changes[0].reelIndex === reelIndex &&
      set.changes[0].slotIndex === first && set.changes[1].slotIndex === second)
    .reduce((sum, item) => sum + item.probability, 0);
  const free = groupChance(0, 0, 1);
  assert.ok(free > 0);
  assert.ok(Math.abs(groupChance(0, 0, 2) / free - 0.01) < 1e-12);
  assert.ok(Math.abs(groupChance(0, 2, 3) / free - 0.01 ** 2) < 1e-12);
  assert.ok(Math.abs(groupChance(1, 0, 1) / free - 1) < 1e-12);
  assert.ok(Math.abs(groupChance(1, 1, 2) / free - 1) < 1e-12);
  assert.ok(Math.abs(outcomes.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);

  const groups = new Map<string, number>();
  for (const { set, probability } of outcomes) {
    const key = JSON.stringify(set.changes.map(({ reelIndex, slotIndex }) => [reelIndex, slotIndex]));
    groups.set(key, (groups.get(key) ?? 0) + probability);
  }
  let start = 0;
  for (const [key, probability] of groups) {
    let call = 0;
    const draw = pickChange(m, { legacy: true, forceDouble: true }, () => call++ === 0 ? start + probability / 2 : 0);
    assert.ok(draw);
    assert.equal(JSON.stringify(draw.changes.map(({ reelIndex, slotIndex }) => [reelIndex, slotIndex])), key);
    start += probability;
  }
});

test('キャパ上限付近の移動変化は同じリールの通常技の劣化より起こりにくい', () => {
  const m = monster();
  m.skills = [
    { id: 'a', name: 'a', kind: 'normal', cost: 1 },
    { id: 'b', name: 'b', kind: 'normal', cost: 2 },
    { id: 'c', name: 'c', kind: 'normal', cost: 3 },
    { id: 's', name: 's', kind: 'charge', cost: 2 },
    { id: 'down', name: 'down', kind: 'down', cost: 2 },
  ];
  m.reels[0].slots = ['b', 'b', 'b', 's', 's', 's'];
  m.reels[0].capacity = 12;
  m.reels.push(
    { level: 2, capacity: 12, samples: [], slots: ['a', 'down', 's', 's', 's', 's'] },
    { level: 3, capacity: 20, samples: [], slots: Array(6).fill('b') },
  );
  const singles = changeDistribution(m, { legacy: true }).filter(({ set }) => set.kind !== 'double');
  const chance = (reel: number, from: string, kind?: string) => singles
    .filter(({ set }) => set.changes[0].reelIndex === reel && set.changes[0].from === from && (!kind || set.kind === kind))
    .reduce((sum, item) => sum + item.probability, 0);
  const degradation = chance(0, 'b', 'degrade');
  assert.ok(degradation > 0);
  assert.ok(Math.abs(chance(0, 's') / degradation - 0.01) < 1e-12);
  assert.equal(chance(1, 'a', 'degrade'), 0);
  assert.ok(chance(1, 'down', 'degrade') > 0);
  assert.ok(Math.abs(chance(1, 's') / chance(1, 'a') - 4) < 1e-12);

  const groups = new Map<string, typeof singles>();
  for (const outcome of singles) {
    const change = outcome.set.changes[0];
    const key = JSON.stringify([change.reelIndex, change.slotIndex]);
    const group = groups.get(key) ?? [];
    group.push(outcome);
    groups.set(key, group);
  }
  const total = singles.reduce((sum, item) => sum + item.probability, 0);
  let groupStart = 0;
  for (const group of groups.values()) {
    const groupChance = group.reduce((sum, item) => sum + item.probability, 0);
    let candidateStart = 0;
    for (const outcome of group) {
      const values = [0.5, (groupStart + groupChance / 2) / total, (candidateStart + outcome.probability / 2) / groupChance];
      let call = 0;
      assert.deepEqual(pickChange(m, { legacy: true }, () => values[call++]), outcome.set);
      candidateStart += outcome.probability;
    }
    groupStart += groupChance;
  }

  const sourceChance = (legacy: boolean, from: string) => changeDistribution(m, { legacy })
    .filter(({ set }) => set.kind !== 'double' && set.changes[0].reelIndex === 0 && set.changes[0].from === from)
    .reduce((sum, item) => sum + item.probability, 0);
  m.reels[0].capacity = 14;
  assert.ok(Math.abs(sourceChance(true, 's') / sourceChance(true, 'b') - 0.01) < 1e-12);
  m.reels[0].capacity = 12;
  assert.ok(Math.abs(sourceChance(false, 's') / sourceChance(false, 'b') - 1) < 1e-12);
});

test('Lv9以下の劣化はリールで習得可能な直下のコスト段階に限る', () => {
  const m = monster();
  m.skills = [
    { id: 'high', name: 'high', kind: 'normal', cost: 5 },
    { id: 'near1', name: 'near1', kind: 'normal', cost: 3.8 },
    { id: 'near2', name: 'near2', kind: 'normal', cost: 3.8 },
    { id: 'unusable', name: 'unusable', kind: 'normal', cost: 4.2, fromLevel: 2 },
    { id: 'shift', name: 'shift', kind: 'up', cost: 3, fromLevel: 1 },
    { id: 'charge', name: 'charge', kind: 'charge', cost: 1, costByLevel: { 1: 3.8 } },
    { id: 'lower', name: 'lower', kind: 'normal', cost: 2.6 },
    { id: 'miss', name: 'miss', kind: 'normal', cost: 0, isMiss: true },
  ];
  m.reels[0].slots = ['high', 'shift', 'shift', 'shift', 'shift', 'miss'];
  m.reels[0].capacity = 17;
  m.reels.push({ level: 2, capacity: 40, samples: [], slots: Array(6).fill('high') });
  const singles = (legacy: boolean) => changeDistribution(m, { legacy })
    .filter(({ set }) => set.kind !== 'double' && set.changes[0].reelIndex === 0);
  const targets = (legacy: boolean, from: string) => new Set(singles(legacy)
    .filter(({ set }) => set.kind === 'degrade' && set.changes[0].from === from)
    .map(({ set }) => set.changes[0].to));
  assert.deepEqual(targets(true, 'high'), new Set(['near1', 'near2', 'charge']));
  assert.deepEqual(targets(true, 'shift'), new Set(['lower']));
  assert.equal(targets(true, 'miss').size, 0);
  const outcomes = singles(true);
  const probability = (from: string) => outcomes.filter(({ set }) => set.changes[0].from === from)
    .reduce((sum, item) => sum + item.probability, 0);
  assert.ok(Math.abs(probability('shift') / probability('high') - 0.01) < 1e-12);
  const allSingles = changeDistribution(m, { legacy: true }).filter(({ set }) => set.kind !== 'double');
  const total = allSingles.reduce((sum, item) => sum + item.probability, 0);
  const first = allSingles[0];
  assert.equal(first.set.changes[0].to, 'near1');
  const values = [0.5, probability('high') / (2 * total), first.probability / (2 * probability('high'))];
  let call = 0;
  assert.deepEqual(pickChange(m, { legacy: true }, () => values[call++]), first.set);

  m.skills.push(
    { id: 'closest', name: 'closest', kind: 'normal', cost: 4.8 },
    { id: 'second', name: 'second', kind: 'normal', cost: 4.4 },
  );
  assert.deepEqual(targets(true, 'high'), new Set(['closest']));
  assert.ok(targets(false, 'high').has('second'));
  m.reels[0].capacity = 19;
  assert.equal(targets(true, 'high').size, 0);
});

test('直下の劣化段階が移動技なら、さらに一段下の通常技も候補にする', () => {
  const m = monster();
  m.skills = [
    { id: 'high', name: 'high', kind: 'normal', cost: 5 },
    { id: 'move', name: 'move', kind: 'up', cost: 4, fromLevel: 1 },
    { id: 'charge', name: 'charge', kind: 'charge', cost: 4 },
    { id: 'normal', name: 'normal', kind: 'normal', cost: 3 },
    { id: 'lower', name: 'lower', kind: 'normal', cost: 2 },
    { id: 'miss', name: 'miss', kind: 'normal', cost: 0, isMiss: true },
  ];
  m.reels[0].slots = Array(6).fill('high');
  m.reels[0].capacity = 31;
  m.reels.push({ level: 2, capacity: 40, samples: [], slots: Array(6).fill('high') });
  const targets = new Set(changeDistribution(m, { legacy: true })
    .filter(({ set }) => set.kind === 'degrade' && set.changes[0].reelIndex === 0 && set.changes[0].from === 'high')
    .map(({ set }) => set.changes[0].to));
  assert.deepEqual(targets, new Set(['move', 'charge', 'normal']));
});


test('個体全体で10回採用した後は新仕様に切り替える', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  const result = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(Math.abs(result.expectedBattles - 2) < 1e-6);
  const tenth = result.policies.find((policy) => policy?.accepted === 10 && policy.slots[0].every((id) => id === 'a'));
  assert.ok(tenth);
  assert.ok(Math.abs(tenth.expectedBattles - 51) < 1e-4, `${tenth.expectedBattles}`);
});


test('変化判定のキャパは指定ランクに従う', () => {
  const m = monster();
  m.reels[0].capacity = 2;
  m.skills[1].cost = 2;
  assert.ok(changeDistribution(withActualCapacities(m), { legacy: false }).length > 0);
  m.capacityIsA = false;
  m.capacityRank = 'B';
  assert.equal(withActualCapacities(m).reels[0].capacity, 1.9);
  assert.equal(changeDistribution(withActualCapacities(m), { legacy: false }).length, 0);
});


test('初期配置はJSONで保持され、削除した移動技を参照しない', () => {
  const m = monster();
  m.skills.push({ id: 'up', name: 'up', cost: 0, kind: 'up', fromLevel: 1 });
  m.reels[0].initialSlots![0] = 'up';
  const copy = importMonster(exportMonster(m));
  assert.deepEqual(copy.reels[0].initialSlots, m.reels[0].initialSlots);
  syncShiftSkills(copy);
  assert.equal(copy.reels[0].initialSlots![0], '');
  assert.equal(m.reels[0].initialSlots![0], 'up');
});


function proposalKey(set: ReturnType<typeof changeDistribution>[number]['set']): string {
  return JSON.stringify([set.kind, set.changes.map((c) => JSON.stringify([c.reelIndex, c.from, c.to])).sort()]);
}

test('同じ技の枠をまとめても旧・新仕様とダブル変化の確率は変わらない', () => {
  const m = monster();
  m.skills = [
    { id: 'a', name: 'a', kind: 'normal', cost: 1 },
    { id: 'b', name: 'b', kind: 'normal', cost: 2 },
    { id: 'c', name: 'c', kind: 'normal', cost: 3 },
    { id: 'd', name: 'd', kind: 'normal', cost: 0, isMiss: true },
  ];
  m.reels[0].slots = ['a', 'b', 'a', 'b', 'a', 'b'];
  m.reels[0].capacity = 10;
  for (const legacy of [true, false]) {
    for (const forceDouble of [false, true]) {
      const opts = { legacy, forceDouble };
      const raw = changeDistribution(m, opts);
      const grouped = changeDistribution(m, opts, true);
      const expected = new Map<string, number>();
      for (const item of raw) {
        const key = proposalKey(item.set);
        expected.set(key, (expected.get(key) ?? 0) + item.probability);
      }
      assert.equal(grouped.length, expected.size);
      for (const item of grouped) assert.ok(Math.abs(item.probability - expected.get(proposalKey(item.set))!) < 1e-12);
      assert.ok(grouped.length <= raw.length);
    }
  }
});

// 小規模な問題を全状態展開し、遅延探索とは独立して値反復する。
function exhaustiveDetails(m: Monster, reelIndex: number, target: number) {
  const start = withActualCapacities(m);
  start.reels = start.reels.map((r) => ({ ...r, slots: [...r.initialSlots!].sort() }));
  const misses = new Set(m.skills.filter((s) => s.isMiss).map((s) => s.id));
  type Entry = { m: Monster; count: number; edges: { next: number; p: number; set: ReturnType<typeof changeDistribution>[number]['set'] }[] };
  const nodes: Entry[] = [{ m: start, count: 0, edges: [] }];
  const key = (x: Monster, count: number) => JSON.stringify([count, x.reels.map((r) => r.slots)]);
  const seen = new Map([[key(start, 0), 0]]);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    for (const { set, probability } of changeDistribution(node.m, { legacy: node.count < 10 })) {
      if (set.changes.some((change) => change.reelIndex !== reelIndex)) continue;
      const next = structuredClone(node.m);
      applyChange(next, set);
      next.reels.forEach((r) => r.slots.sort());
      let dest = -1;
      if (next.reels[reelIndex].slots.filter((id) => misses.has(id)).length < target) {
        const count = Math.min(10, node.count + 1);
        const k = key(next, count);
        const found = seen.get(k);
        if (found === undefined) {
          assert.ok(nodes.length < 5000);
          dest = nodes.length; seen.set(k, dest); nodes.push({ m: next, count, edges: [] });
        } else dest = found;
      }
      node.edges.push({ next: dest, p: probability, set });
    }
  }
  const values = nodes.map(() => Infinity);
  for (let sweep = 0; sweep < 1000; sweep++) {
    let delta = 0;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const choices = nodes[i].edges.map((e) => ({ p: e.p, v: e.next < 0 ? 0 : values[e.next] }))
        .filter((e) => Number.isFinite(e.v)).sort((a, b) => a.v - b.v);
      let p = 0, sum = 0, best = Infinity;
      for (const c of choices) { p += c.p; sum += c.p * c.v; best = Math.min(best, (1 + sum) / p); }
      if (best < values[i]) { delta = Math.max(delta, values[i] - best); values[i] = best; }
    }
    if (delta < 1e-10) break;
  }
  return { value: values[0], edges: nodes[0].edges, values };
}

const exhaustive = (m: Monster, reelIndex: number, target: number): number => exhaustiveDetails(m, reelIndex, target).value;

test('遅延探索の上下限は小規模の全探索結果を含む', () => {
  const cases = [monster(), monster(), monster()];
  cases[1].skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  cases[2].skills[0].cost = 1;
  cases[2].skills[1].cost = 0;
  cases[2].reels[0].capacity = 6;
  cases[2].skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 2 });
  for (const m of cases) {
    const exact = exhaustive(m, 0, 1);
    const result = planMiss(m, { reelIndex: 0, target: 1 });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') continue;
    assert.ok(result.lower <= exact + 1e-8 && result.upper >= exact - 1e-8, `${result.lower} <= ${exact} <= ${result.upper}`);
    assert.ok(Math.abs(result.expectedBattles - exact) < 1e-5);
  }
});

test('探索上限は到達不能とせず範囲を表示する', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  const exact = exhaustive(m, 0, 2);
  const result = planMiss(m, { reelIndex: 0, target: 2 }, undefined, { maxStates: 2 });
  assert.equal(result.status, 'limit');
  if (result.status === 'limit') {
    assert.ok(result.progress.lower <= exact);
    assert.ok(result.progress.upper === null || result.progress.upper >= exact);
  }
});

test('循環を含む探索で各状態数上限の範囲が全探索の期待値を含む', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  const exact = exhaustive(m, 0, 2);
  let limited = 0;
  for (const maxStates of [2, 10, 30, 80, 200]) {
    const result = planMiss(m, { reelIndex: 0, target: 2 }, undefined, { maxStates });
    assert.ok(result.status === 'limit' || result.status === 'ok');
    if (result.status === 'limit') {
      limited++;
      assert.ok(result.progress.lower <= exact + 1e-8);
      assert.ok(result.progress.upper === null || result.progress.upper >= exact - 1e-8);
    } else if (result.status === 'ok') {
      assert.ok(result.lower <= exact + 1e-8 && result.upper >= exact - 1e-8);
      assert.ok(Math.abs(result.expectedBattles - exact) < 1e-5);
    }
  }
  assert.ok(limited > 0);
});

test('ダブル変化を含む全探索の期待値と初期方針が一致する', () => {
  const m = monster();
  m.skills = [
    { id: 'a', name: 'a', kind: 'normal', cost: 1 },
    { id: 'b', name: 'b', kind: 'normal', cost: 2 },
    { id: 'c', name: 'c', kind: 'normal', cost: 3 },
    { id: 'm', name: 'miss', kind: 'normal', cost: 0, isMiss: true },
  ];
  m.reels[0].capacity = 9;
  m.reels[0].initialSlots = ['a', 'b', 'a', 'b', 'a', 'b'];
  const exact = exhaustiveDetails(m, 0, 1);
  const result = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(result.lower <= exact.value + 1e-8 && result.upper >= exact.value - 1e-8);
  assert.ok(Math.abs(result.expectedBattles - exact.value) < 1e-5);
  const expected = new Map<string, { probability: number; nextValue: number }>();
  for (const edge of exact.edges) {
    const key = proposalKey(edge.set);
    const item = expected.get(key);
    if (item) item.probability += edge.p;
    else expected.set(key, { probability: edge.p, nextValue: edge.next < 0 ? 0 : exact.values[edge.next] });
  }
  const choices = result.policies[0]!.choices;
  assert.equal(choices.length, expected.size);
  assert.ok(choices.some((choice) => choice.set.kind === 'double'));
  for (const choice of choices) {
    const entry = expected.get(proposalKey(choice.set));
    assert.ok(entry);
    assert.ok(Math.abs(choice.probability - entry.probability) < 1e-12);
    if (Math.abs(entry.nextValue - exact.value) > 1e-5) assert.equal(choice.accept, entry.nextValue < exact.value);
  }
});

test('候補辺数と時間の上限も打ち切りとして扱う', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  for (const limits of [{ maxEdges: 1 }, { maxElapsedMs: 0 }]) {
    const result = planMiss(m, { reelIndex: 0, target: 2 }, undefined, limits);
    assert.equal(result.status, 'limit');
    if (result.status === 'limit') assert.match(result.message, /上限/);
  }
});

test('循環できてもミスに到達できない場合は到達不能とする', () => {
  const m = monster();
  m.skills[1].cost = 2;
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  assert.equal(planMiss(m, { reelIndex: 0, target: 1 }).status, 'unreachable');
});


test('対象外リールの提案を拒否した期待値が全探索と一致する', () => {
  const m = monster();
  m.skills.push({ id: 'b', name: 'b', kind: 'normal', cost: 0 });
  m.reels.push({ level: 2, capacity: 1, samples: [], slots: Array(6).fill('a'), initialSlots: Array(6).fill('a') });
  const exact = exhaustive(m, 0, 1);
  const result = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(Math.abs(exact - 4) < 1e-8);
  assert.ok(result.lower <= exact + 1e-8 && result.upper >= exact - 1e-8);
  for (const policy of result.policies) {
    if (!policy) continue;
    assert.deepEqual(policy.slots[1], Array(6).fill('a'));
    assert.ok(policy.choices.every((choice) => choice.set.changes.every((change) => change.reelIndex === 0)));
  }
  const sequence = recommendedSequence(result.policies, 0);
  assert.ok(sequence);
  assert.ok(Math.abs(sequence.reduce((sum, step) => sum + 1 / step.probability, 0) - 4) < 1e-8);
});

test('複数の提案を同じ手順にまとめ、分岐した経路の待機回数を区別する', () => {
  const choice = (from: string, to: string, probability: number, next: number, reelIndex = 0): MissPlanChoice => ({
    set: { kind: 'up', changes: [{ reelIndex, slotIndex: 0, from, to }] },
    probability, next, accept: true,
  });
  const policy = (choices: MissPlanChoice[], slots: string[] = ['a']): MissPlanPolicy => ({ slots: [slots], accepted: 0, expectedBattles: 1, choices });
  const policies = [
    policy([choice('a', 'b', 0.1, 1), choice('a', 'b', 0.2, 1), choice('a', 'd', 0.25, 2), choice('a', 'b', 0.4, -1, 1)]),
    policy([{ set: { kind: 'double', changes: [{ reelIndex: 0, slotIndex: 0, from: 'b', to: 'm' }, { reelIndex: 0, slotIndex: 1, from: 'a', to: 'b' }] }, probability: 0.5, next: -1, accept: true }], ['b']),
    policy([choice('d', 'm', 0.1, -1)], ['d']),
  ];
  const sequence = recommendedSequence(policies, 0);
  assert.ok(sequence);
  assert.equal(sequence.length, 2);
  assert.equal(sequence[0].choices.length, 2);
  assert.equal(sequence[1].choices[0].set.changes.length, 2);
  assert.ok(Math.abs(sequence[0].probability - 0.3) < 1e-12);
  assert.ok(Math.abs(sequence.reduce((sum, step) => sum + 1 / step.probability, 0) - (1 / 0.3 + 2)) < 1e-12);
  assert.equal(recommendedSequence([policy([choice('a', 'b', 1, 0)])], 0), null);
  assert.equal(recommendedSequence([policy([choice('a', 'b', 1, -2)])], 0), null);
});

test('リール例は初期順を保ち、同じ技とダブル変化を別枠に反映する', () => {
  const choice = (changes: { from: string; to: string }[]): MissPlanChoice => ({
    set: { kind: changes.length === 2 ? 'double' : 'up', changes: changes.map((c, i) => ({ reelIndex: 0, slotIndex: i, ...c })) },
    probability: 0.1, next: -1, accept: true,
  });
  const initial = ['x', 'a', 'b', 'a', 'x', 'x'];
  const steps = [
    { choices: [choice([{ from: 'a', to: 'b' }, { from: 'a', to: 'm' }]), choice([{ from: 'a', to: 'm' }, { from: 'a', to: 'b' }])], probability: 0.2 },
    { choices: [choice([{ from: 'b', to: 'm' }])], probability: 0.1 },
  ];
  const samples = missPlanSamples(initial, steps, 0);
  assert.ok(samples);
  assert.deepEqual(samples[0][0].map((slot) => slot.after), ['x', 'b', 'b', 'm', 'x', 'x']);
  assert.deepEqual(samples[0][1].map((slot) => slot.after), ['x', 'm', 'b', 'b', 'x', 'x']);
  assert.equal(samples[0][0].filter((slot) => slot.before !== slot.after).length, 2);
  assert.deepEqual(samples[1][0].map((slot) => slot.after), ['x', 'm', 'b', 'm', 'x', 'x']);
  assert.equal(missPlanSamples(initial, [{ choices: [choice([{ from: 'missing', to: 'm' }])], probability: 1 }], 0), null);
});

test('採用回数が違っても同じ配置へ戻る分岐を避け、別の経路を探す', () => {
  const choice = (from: string, to: string, probability: number, next: number): MissPlanChoice => ({
    set: { kind: 'up', changes: [{ reelIndex: 0, slotIndex: 0, from, to }] },
    probability, next, accept: true,
  });
  const policy = (slots: string[], accepted: number, choices: MissPlanChoice[]): MissPlanPolicy =>
    ({ slots: [slots], accepted, expectedBattles: 1, choices });
  const policies = [
    policy(['a', 'x'], 0, [choice('a', 'b', 0.8, 1), choice('a', 'c', 0.2, 3)]),
    policy(['b', 'x'], 1, [choice('b', 'a', 1, 2)]),
    policy(['x', 'a'], 2, [choice('a', 'm', 1, -1)]),
    policy(['c', 'x'], 1, [choice('c', 'm', 0.5, -1)]),
  ];
  const sequence = recommendedSequence(policies, 0);
  assert.ok(sequence);
  assert.deepEqual(sequence.map((step) => step.choices[0].set.changes[0].to), ['c', 'm']);
  assert.equal(recommendedSequence(policies.slice(0, 3), 0), null);
});

test('別の変化を挟んだ逆戻りと3種類以上の技の循環を除外する', () => {
  const set = (from: string, to: string) => ({ kind: 'up' as const, changes: [{ reelIndex: 0, slotIndex: 0, from, to }] });
  let history: TransitionHistory = [];
  history = extendTransitions(history, set('a', 'b'))!;
  history = extendTransitions(history, set('x', 'y'))!;
  assert.equal(extendTransitions(history, set('b', 'a')), null);
  history = extendTransitions(history, set('b', 'c'))!;
  assert.equal(extendTransitions(history, set('c', 'a')), null);
  assert.ok(extendTransitions(history, set('a', 'b')));
});

test('初期状態で達成済みなら変化手順は不要', () => {
  const m = monster();
  m.reels[0].initialSlots![0] = 'm';
  const result = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(recommendedSequence(result.policies, 0), []);
  assert.match(renderMissPlan(m, 0, 1, result, false, null), /初期状態ですでに目標ミス枠数を達成/);
});


test('移動技の保護を含む候補集約でも確率を保持する', () => {
  const m = monster();
  m.skills.push({ id: 'up', name: 'up', kind: 'up', fromLevel: 1, cost: 0 });
  m.reels[0].slots = ['up', 'up', 'a', 'a', 'a', 'a'];
  m.reels.push({ level: 2, capacity: 1, samples: [], slots: Array(6).fill('a') });
  const raw = changeDistribution(m, { legacy: true });
  const grouped = changeDistribution(m, { legacy: true }, true);
  const expected = new Map<string, number>();
  for (const item of raw) {
    const key = proposalKey(item.set);
    expected.set(key, (expected.get(key) ?? 0) + item.probability);
  }
  for (const item of grouped) assert.ok(Math.abs(item.probability - expected.get(proposalKey(item.set))!) < 1e-12);
  assert.ok(Math.abs(grouped.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);
});

test('4リールの簡単なケースでも目標の期待値に収束する', () => {
  const m = monster();
  for (let level = 2; level <= 4; level++) {
    m.reels.push({ level, capacity: 1, samples: [], slots: Array(6).fill('a'), initialSlots: Array(6).fill('a') });
  }
  const result = planMiss(m, { reelIndex: 0, target: 1 });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.ok(Math.abs(result.expectedBattles - 4) < 1e-5);
});


test('魔王レオナーレの★★ミス2枠について実行可能な方針を返す', () => {
  const m = JSON.parse(readFileSync(new URL('./fixtures/leonare.json', import.meta.url), 'utf8')) as Monster;
  const result = planMiss(m, { reelIndex: 1, target: 2 });
  assert.equal(result.status, 'limit');
  if (result.status !== 'limit') return;
  assert.ok(result.route, '上限到達時も実行可能な経路が必要');
  const route = result.route;
  assert.ok(result.progress.lower <= route.expectedBattles);
  assert.ok(result.progress.upper !== null && result.progress.upper <= route.expectedBattles);
  assert.ok(route.policies.length > 0);
  const layouts = route.policies.map((policy) => JSON.stringify([...policy.slots[1]].sort()));
  assert.equal(new Set(layouts).size, layouts.length, '採用回数に関係なくリール配置が重複しない');
  let history: TransitionHistory = [];
  const sequence = recommendedSequence(route.policies, 1);
  assert.ok(sequence);
  assert.equal(sequence.length, route.policies.length);
  assert.ok(Math.abs(sequence.reduce((sum, step) => sum + 1 / step.probability, 0) - route.expectedBattles) < 1e-8);
  const samples = missPlanSamples(m.reels[1].initialSlots!, sequence, 1);
  assert.ok(samples);
  for (let i = 0; i < samples.length; i++) {
    for (const sample of samples[i]) {
      assert.equal(sample.length, 6);
      assert.deepEqual(sample.map((slot) => slot.before).sort(), [...route.policies[i].slots[1]].sort());
      const after = sample.map((slot) => slot.after).sort();
      if (i + 1 < samples.length) assert.deepEqual(after, [...route.policies[i + 1].slots[1]].sort());
      else assert.ok(after.filter((id) => id === 'ifpgvpik').length >= 2);
    }
  }
  const html = renderMissPlan(m, 1, 2, result, false, null);
  assert.match(html, /以下の変化だけを順番に採用する場合/);
  assert.equal((html.match(/class="miss-plan-step"/g) ?? []).length, sequence.length);
  assert.equal((html.match(/aria-label="★★ 変化後のリール例"/g) ?? []).length, sequence.reduce((sum, step) => sum + step.choices.length, 0));
  assert.match(html, /miss-plan-changed/);
  assert.doesNotMatch(html, /採用後を見る|miss-plan-state|miss-plan-page/);
  let expected = 0;
  for (let i = 0; i < route.policies.length; i++) {
    const policy = route.policies[i];
    const state = withActualCapacities(m);
    state.reels.forEach((reel, j) => { reel.slots = [...policy.slots[j]]; });
    const accepted = policy.choices.filter((choice) => choice.accept);
    const probability = accepted.reduce((sum, choice) => sum + choice.probability, 0);
    assert.ok(probability > 0);
    expected += 1 / probability;
    const distribution = changeDistribution(state, { legacy: policy.accepted < 10 }, true);
    for (const choice of accepted) {
      assert.ok(extendTransitions(history, choice.set), '別の変化を挟んでも技の変化は循環しない');
      assert.ok(choice.set.changes.every((c) => c.reelIndex === 1));
      const matching = distribution.find((item) => proposalKey(item.set) === proposalKey(choice.set));
      assert.ok(matching && Math.abs(matching.probability - choice.probability) < 1e-12);
      const next = structuredClone(state);
      applyChange(next, choice.set);
      next.reels[1].slots.sort();
      const missCount = next.reels[1].slots.filter((id) => id === 'ifpgvpik').length;
      if (i === route.policies.length - 1) {
        assert.equal(choice.next, -1);
        assert.ok(missCount >= 2);
      } else {
        assert.equal(choice.next, i + 1);
        assert.deepEqual(next.reels.map((reel) => reel.slots), route.policies[i + 1].slots);
      }
      history = extendTransitions(history, accepted[0].set)!;
    }
  }
  assert.ok(Math.abs(expected - route.expectedBattles) < 1e-8);
});
