import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evolutionStateKey,
  evolutionTransitionDistribution,
  isEvolutionGoal,
  prepareEvolutionPlan,
  type EvolutionPlanInput,
} from '../src/core/evolution-plan.ts';
import type { Monster } from '../src/core/types.ts';

const oldId = 'old';
const newId = 'new';
const makeMonster = (): Monster => ({
  id: 'test',
  name: 'test',
  capacityRank: 'A',
  skills: [
    { id: oldId, name: '旧技', cost: 1, kind: 'normal' },
    { id: newId, name: '新技', cost: 2, kind: 'normal' },
  ],
  reels: [
    { level: 1, capacity: 13, slots: Array(6).fill(oldId), samples: [] },
    { level: 2, capacity: 13, slots: Array(6).fill(oldId), samples: [] },
  ],
});

const input = (overrides: Partial<EvolutionPlanInput> = {}): EvolutionPlanInput => ({
  monster: makeMonster(),
  reelIndex: 0,
  initialSlots: Array(6).fill(oldId),
  targetSlots: Array(6).fill(newId),
  capacityRank: 'A',
  ...overrides,
});

test('目標判定と状態キーは配置順モードに応じて構成を区別する', () => {
  const initial = [oldId, newId, oldId, oldId, oldId, oldId];
  const permuted = [oldId, oldId, oldId, oldId, newId, oldId];
  assert.equal(isEvolutionGoal(initial, permuted, false), true);
  assert.equal(isEvolutionGoal(initial, permuted, true), false);
  assert.equal(
    evolutionStateKey({ slots: initial, level: 4 }, false),
    evolutionStateKey({ slots: permuted, level: 4 }, false),
  );
  assert.notEqual(
    evolutionStateKey({ slots: initial, level: 4 }, true),
    evolutionStateKey({ slots: permuted, level: 4 }, true),
  );
  assert.notEqual(
    evolutionStateKey({ slots: initial, level: 4 }, false),
    evolutionStateKey({ slots: initial, level: 5 }, false),
  );
});

test('入力検証は初期・目標構成の技習得可否とキャパシティを確認する', () => {
  const invalidSkill = prepareEvolutionPlan(input({ targetSlots: Array(6).fill('unknown') }));
  assert.equal(invalidSkill.valid, false);
  if (!invalidSkill.valid) assert.match(invalidSkill.errors.join(' '), /不明な技ID/);

  const overCapacity = prepareEvolutionPlan(input({
    monster: {
      ...makeMonster(),
      reels: makeMonster().reels.map((reel, index) => index === 0 ? { ...reel, capacity: 11 } : reel),
    },
  }));
  assert.equal(overCapacity.valid, false);
  if (!overCapacity.valid) assert.match(overCapacity.errors.join(' '), /キャパシティ/);

  const invalidLimit = prepareEvolutionPlan(input({ limits: { maxStates: 1.5 } }));
  assert.equal(invalidLimit.valid, false);
  if (!invalidLimit.valid) assert.match(invalidLimit.errors.join(' '), /maxStates/);
});

test('変化候補確率を既存抽選モデルから列挙し、対象外リール提案を拒否にする', () => {
  const prepared = prepareEvolutionPlan(input());
  assert.equal(prepared.valid, true);
  if (!prepared.valid) return;

  const distribution = evolutionTransitionDistribution(prepared.plan, {
    slots: prepared.plan.initialSlots,
    level: 1,
  });
  assert.ok(distribution.proposals.length > 0);
  assert.ok(Math.abs(distribution.proposalProbability + distribution.noProposalProbability - 1) < 1e-12);
  assert.ok(Math.abs(distribution.transitions.reduce((sum, edge) => sum + edge.probability, 0) +
    distribution.noProposalProbability - 1) < 1e-12);
  assert.ok(distribution.proposals.some((proposal) => !proposal.affectsTargetReel));
  assert.ok(distribution.proposals.filter((proposal) => !proposal.affectsTargetReel).every((proposal) =>
    proposal.next.level === 1 && proposal.next.slots.every((id, index) => id === oldId),
  ));
});

test('レベル10の対象リール採用はレベルを上げず、他リール提案はレベルを維持する', () => {
  const prepared = prepareEvolutionPlan(input());
  assert.equal(prepared.valid, true);
  if (!prepared.valid) return;

  const distribution = evolutionTransitionDistribution(prepared.plan, {
    slots: prepared.plan.initialSlots,
    level: 10,
  });
  assert.ok(distribution.proposals.some((proposal) =>
    proposal.affectsTargetReel && proposal.next.level === 10,
  ));
  assert.ok(distribution.proposals.some((proposal) =>
    !proposal.affectsTargetReel && proposal.next.level === 10,
  ));
});
