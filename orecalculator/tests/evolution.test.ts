import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolveMonster, type MasterEvolution } from '../src/core/evolution.ts';
import { copyMasterMonster, type MasterMonster, type MasterSkill } from '../src/core/master.ts';

const oldId = 'c7695860-44d8-4701-8492-42fa4542969e';
const newId = 'c7695860-44d8-4701-8492-42fa4542969f';
const chargeId = 'c7695860-44d8-4701-8492-42fa45429690';
const sourceId = 'a4d5fc67-5d35-4ff5-b464-4296d3ce32da';
const targetId = 'a4d5fc67-5d35-4ff5-b464-4296d3ce32db';
const skills: MasterSkill[] = [
  { id: oldId, name: '旧技', kind: 'normal', is_miss: false, default_cost: 1 },
  { id: newId, name: '新技', kind: 'normal', is_miss: false, default_cost: 2 },
  { id: chargeId, name: 'ためる', kind: 'charge', is_miss: false, default_cost: 1 },
];
const entry = (skillId: string, count: number) => ({ skillId, cost: null, fromLevel: null, costByLevel: Array(count).fill(null) });
const reel = (id: string, min: number, max: number) => ({ capacityMin: min, capacityMax: max, slots: Array(6).fill(id) });
const source: MasterMonster = { id: sourceId, name: '進化前', class_level: 1, skills: [entry(oldId, 1)], reels: [reel(oldId, 5, 5)] };
const target: MasterMonster = { id: targetId, name: '進化後', class_level: 2, skills: [entry(newId, 2), entry(chargeId, 2)], reels: [reel(newId, 8, 8), reel(newId, 10, 12)] };
const rule: MasterEvolution = { id: 'rule', source_id: sourceId, target_id: targetId, method: 'class_change', condition: '', inheritance: 'inherit', mappings: [{ from: oldId, to: newId }], replacement: { skillIds: [chargeId], notes: '' }, notes: '' };

test('進化は旧最高リールを1枠置換し、対応する技と追加リールを引き継いで別個体を作る', () => {
  const original = copyMasterMonster(source, skills, [5]);
  original.reels[0].samples = [{ slots: Array(6).fill(oldId) }];
  original.capacityRank = 'B';
  const result = evolveMonster(original, source, target, skills, rule, [8, 11], { slot: 2, skillId: chargeId });
  assert.notEqual(result.id, original.id);
  assert.equal(result.masterId, targetId);
  assert.equal(result.capacityRank, 'B');
  assert.deepEqual(result.reels[0].slots, [newId, newId, chargeId, newId, newId, newId]);
  assert.deepEqual(result.reels[0].initialSlots, result.reels[0].slots);
  assert.deepEqual(result.reels[1].slots, Array(6).fill(newId));
  assert.deepEqual(result.reels.map((r) => r.capacity), [8, 11]);
  assert.deepEqual(result.reels[0].samples, []);
  result.reels[0].slots[0] = '';
  assert.equal(result.reels[0].initialSlots?.[0], newId);
  assert.deepEqual(original.reels[0].slots, Array(6).fill(oldId));
});

test('進化ルールや技が不正な場合は個体を作らない', () => {
  const original = copyMasterMonster(source, skills, [5]);
  assert.throws(() => evolveMonster(original, source, target, skills, rule, [8, 11]), /枠と技/);
  assert.throws(() => evolveMonster(original, source, target, skills, rule, [8, 11], { slot: 6, skillId: chargeId }), /枠と技/);
  assert.throws(() => evolveMonster(original, source, target, skills, rule, [8, 11], { slot: 1, skillId: newId }), /枠と技/);
  assert.throws(() => evolveMonster(original, source, target, skills, { ...rule, mappings: [] }, [8, 11], { slot: 1, skillId: chargeId }), /進化先にありません/);
  assert.throws(() => evolveMonster(original, source, target, skills, rule, [8, 13], { slot: 1, skillId: chargeId }), /キャパシティ/);
  assert.throws(() => evolveMonster({ ...original, masterId: targetId }, source, target, skills, rule, [8, 11], { slot: 1, skillId: chargeId }), /一致/);
});

test('引き継ぎなしは全リールに進化先固定配置を使用し、旧個体のサンプルを継承しない', () => {
  const original = copyMasterMonster(source, skills, [5]);
  original.reels[0].samples = [{ slots: Array(6).fill(oldId) }];
  const result = evolveMonster(original, source, target, skills, { ...rule, inheritance: 'fixed' }, [8, 10]);
  assert.deepEqual(result.reels.map((r) => r.slots), [Array(6).fill(newId), Array(6).fill(newId)]);
  assert.deepEqual(result.reels[0].samples, []);
});

test('旧個体の独自技IDは明示的な対応付けで進化元マスターへ変換する', () => {
  const original = copyMasterMonster(source, skills, [5]);
  delete original.masterId;
  original.skills[0].id = 'local-skill';
  original.reels[0].slots.fill('local-skill');
  assert.throws(() => evolveMonster(original, source, target, skills, rule, [8, 10], { slot: 0, skillId: chargeId }), /進化元の技を選択/);
  const result = evolveMonster(original, source, target, skills, rule, [8, 10], { slot: 0, skillId: chargeId }, { 'local-skill': oldId });
  assert.deepEqual(result.reels[0].slots, [chargeId, newId, newId, newId, newId, newId]);
});
