import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyMasterMonster, type MasterMonster, type MasterSkill } from '../src/core/master.ts';
import { costAt } from '../src/core/types.ts';
import { slotCost } from '../src/core/calc.ts';
import { validateRecord } from '../../orecalculator-admin/validate.mjs';

const skillId = 'c7695860-44d8-4701-8492-42fa4542969e';
const id = 'a4d5fc67-5d35-4ff5-b464-4296d3ce32da';
const skill: MasterSkill = { id: skillId, name: 'こうげき', kind: 'normal', is_miss: false, default_cost: 1.5, default_from_level: null, default_cost_by_level: [null, null, null, null] };
function monster(): MasterMonster {
  return { id, name: '試験', class_level: 1, skills: [{ skillId, cost: null, fromLevel: null, costByLevel: [2] }],
    reels: [{ capacityMin: 6, capacityMax: 10, slots: [skillId, null, null, null, null, null] }] };
}

test('共通マスターの検証は未設定の配置と範囲を保ち不正な値を拒否する', () => {
  const m = monster();
  assert.equal(validateRecord('monsters', m), null);
  assert.equal(validateRecord('skills', skill), null);
  assert.match(validateRecord('skills', { ...skill, default_cost: null }) ?? '', /標準コスト/);
  assert.equal(validateRecord('skills', { ...skill, default_cost: 0 }), null);
  assert.equal(validateRecord('skills', { ...skill, default_cost: -1.5 }), null);
  m.skills[0].cost = -2;
  m.skills[0].costByLevel[0] = -3;
  assert.equal(validateRecord('monsters', m), null);
  assert.match(validateRecord('skills', { ...skill, default_cost: Number.NaN }) ?? '', /標準コスト/);
  m.skills[0].cost = Number.POSITIVE_INFINITY;
  assert.match(validateRecord('monsters', m) ?? '', /コスト/);
  m.skills[0].cost = null;
  m.reels[0].capacityMin = -1;
  assert.match(validateRecord('monsters', m) ?? '', /キャパシティ/);
  m.reels[0].capacityMin = 11;
  assert.match(validateRecord('monsters', m) ?? '', /キャパシティ/);
  m.reels[0].capacityMin = null;
  m.reels[0].slots[0] = 'unknown';
  assert.match(validateRecord('monsters', m) ?? '', /固定配置/);
  assert.match(validateRecord('skills', { ...skill, kind: 'up', is_miss: true }) ?? '', /ミス/);
});

test('技の入力エラーは問題の行と具体的な理由を返す', () => {
  const m = monster();
  m.skills.push({ ...m.skills[0], costByLevel: [2] });
  assert.match(validateRecord('monsters', m) ?? '', /2番目.*同じ技/);
  m.skills[1].skillId = '';
  assert.match(validateRecord('monsters', m) ?? '', /2番目.*選択/);
  m.skills.pop();
  m.skills[0].costByLevel = [];
  assert.match(validateRecord('monsters', m) ?? '', /1番目.*数.*クラス/);
  m.skills[0].costByLevel = [NaN];
  assert.match(validateRecord('monsters', m) ?? '', /1番目.*リール別コスト/);
  m.skills[0].costByLevel = [null];
  m.skills[0].fromLevel = 2;
  assert.match(validateRecord('monsters', m) ?? '', /1番目.*発生リール/);
});

test('共通のリール設定を個体へコピーし、モンスター別設定を優先する', () => {
  const m = monster();
  m.skills[0].costByLevel[0] = null;
  const defaults = { ...skill, default_from_level: 1, default_cost_by_level: [1.4, null, null, null] };
  const copy = copyMasterMonster(m, [defaults], [8]);
  assert.equal(copy.skills[0].fromLevel, 1);
  assert.equal(costAt(copy.skills[0], 1), 1.4);
  m.skills[0].fromLevel = 1;
  assert.equal(copyMasterMonster(m, [{ ...defaults, default_from_level: 2 }], [8]).skills[0].fromLevel, 1);
  m.skills[0].cost = -2;
  assert.equal(costAt(copyMasterMonster(m, [defaults], [8]).skills[0], 1), -2);
  m.skills[0].costByLevel[0] = 0;
  assert.equal(costAt(copyMasterMonster(m, [defaults], [8]).skills[0], 1), 0);
  assert.match(validateRecord('skills', { ...defaults, default_from_level: 5 }) ?? '', /リール/);
  assert.match(validateRecord('skills', { ...defaults, default_cost_by_level: [1] }) ?? '', /リール/);
  assert.match(validateRecord('skills', { ...defaults, default_cost_by_level: [1, NaN, null, null] }) ?? '', /リール/);
  const { default_from_level, default_cost_by_level, ...legacy } = defaults;
  assert.equal(costAt(copyMasterMonster(m, [legacy], [8]).skills[0], 1), 0);
});

test('マスターコピーは仮キャパの範囲と技参照を検証し、既存個体と分離する', () => {
  const m = monster();
  assert.throws(() => copyMasterMonster(m, [skill], [5]), /キャパシティ/);
  assert.throws(() => copyMasterMonster(m, [], [8]), /技マスター/);
  const copy = copyMasterMonster(m, [skill], [8]);
  assert.equal(copy.reels[0].capacity, 8);
  assert.equal(copy.skills[0].cost, 1.5);
  assert.equal(copy.skills[0].costByLevel?.[1], 2);
  assert.equal(costAt(copy.skills[0], 1), 2);
  assert.deepEqual(copy.reels[0].slots, [skillId, '', '', '', '', '']);
  copy.reels[0].slots[0] = '';
  assert.equal(m.reels[0].slots[0], skillId);
  assert.equal(copy.reels[0].initialSlots?.[0], skillId);
  m.skills[0].cost = 3;
  assert.equal(copyMasterMonster(m, [skill], [8]).skills[0].cost, 3);
  m.skills[0].cost = 0;
  assert.equal(copyMasterMonster(m, [skill], [8]).skills[0].cost, 0);
  m.skills[0].cost = null;
  assert.throws(() => copyMasterMonster(m, [{ ...skill, default_cost: null }], [8]), /コスト/);
  assert.equal(copyMasterMonster(m, [{ ...skill, default_cost: 0 }], [8]).skills[0].cost, 0);
  const negative = copyMasterMonster(m, [{ ...skill, default_cost: -1.5 }], [8]);
  assert.equal(negative.skills[0].cost, -1.5);
  m.skills[0].cost = -2;
  m.skills[0].costByLevel[0] = -3;
  const override = copyMasterMonster(m, [skill], [8]);
  assert.equal(override.skills[0].cost, -2);
  assert.equal(costAt(override.skills[0], 1), -3);
  assert.equal(slotCost({ slots: [skillId, skillId] }, override.skills, 1), -6);
});
