import { slotCost, validate } from './calc.ts';
import { changeDistribution, type ChangeSet, type WeightedChange } from './change.ts';
import {
  CAPACITY_RANKS,
  SLOTS,
  usableAt,
  withActualCapacities,
  type CapacityRank,
  type Monster,
} from './types.ts';

export interface EvolutionPlanLimits {
  maxStates?: number;
  maxEdges?: number;
  maxElapsedMs?: number;
}

export interface EvolutionPlanInput {
  monster: Monster;
  reelIndex: number;
  initialSlots: readonly string[];
  targetSlots: readonly string[];
  capacityRank: CapacityRank;
  startLevel?: number;
  orderMatters?: boolean;
  limits?: EvolutionPlanLimits;
  tolerance?: number;
}

export interface EvolutionPlanState {
  slots: readonly string[];
  level: number;
}

export type EvolutionPlanStatus = 'converged' | 'limit_reached' | 'unreachable' | 'invalid_input' | 'error';

export interface EvolutionPlanChoice {
  proposal: WeightedChange;
  action: 'accept' | 'reject';
  next: EvolutionPlanState;
}

export interface EvolutionPlanPolicy {
  state: EvolutionPlanState;
  expectedBattles: number | null;
  choices: EvolutionPlanChoice[];
}

export interface EvolutionPlanRoute {
  expectedBattles: number;
  steps: EvolutionPlanPolicy[];
}

export interface EvolutionPlanResult {
  status: EvolutionPlanStatus;
  optimalExpectedBattles: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  lowerBoundFinite: boolean;
  upperBoundFinite: boolean;
  errorBound: number | null;
  stateCount: number;
  edgeCount: number;
  elapsedMs: number;
  currentPolicy: EvolutionPlanPolicy | null;
  recommendedProposals: WeightedChange[];
  representativeRoute: EvolutionPlanRoute | null;
  message?: string;
}

export interface PreparedEvolutionPlan {
  monster: Monster;
  reelIndex: number;
  initialSlots: readonly string[];
  targetSlots: readonly string[];
  startLevel: number;
  orderMatters: boolean;
  limits: Required<EvolutionPlanLimits>;
  tolerance: number;
}

export type EvolutionPlanValidation =
  | { valid: true; plan: PreparedEvolutionPlan }
  | { valid: false; status: 'invalid_input'; errors: string[] };

export interface EvolutionProposal {
  set: ChangeSet;
  probability: number;
  next: EvolutionPlanState;
  affectsTargetReel: boolean;
}

/** Multiple proposals that lead to the same target state, with their original proposals retained. */
export interface EvolutionTransitionCandidate {
  next: EvolutionPlanState;
  probability: number;
  proposals: WeightedChange[];
}

export interface EvolutionTransitionDistribution {
  proposals: EvolutionProposal[];
  transitions: EvolutionTransitionCandidate[];
  proposalProbability: number;
  noProposalProbability: number;
}

const DEFAULT_LIMITS: Required<EvolutionPlanLimits> = {
  maxStates: 20000,
  maxEdges: 250000,
  maxElapsedMs: 15000,
};

function normalizedSlots(slots: readonly string[], orderMatters: boolean): string[] {
  return orderMatters ? [...slots] : [...slots].sort();
}

function validConfiguration(
  monster: Monster,
  reelIndex: number,
  slots: readonly string[],
  label: string,
): string[] {
  const reel = monster.reels[reelIndex];
  const errors: string[] = [];
  const skills = new Map(monster.skills.map((skill) => [skill.id, skill]));
  if (slots.length !== SLOTS) return [`${label}: 6枠すべてに技を指定してください。`];

  for (const id of slots) {
    const skill = skills.get(id);
    if (!skill) {
      errors.push(`${label}: 不明な技ID「${id}」があります。`);
    } else if (!usableAt(skill, reel.level, monster.reels.length)) {
      errors.push(`${label}: 技「${skill.name}」は対象リールで使用できません。`);
    }
  }
  if (errors.length) return errors;

  const cost = slotCost({ slots: [...slots] }, monster.skills, reel.level);
  if (cost > reel.capacity) errors.push(`${label}: キャパシティ ${reel.capacity} を超えています（合計 ${cost}）。`);
  return errors;
}

export function prepareEvolutionPlan(input: EvolutionPlanInput): EvolutionPlanValidation {
  const errors: string[] = [];
  if (!Number.isInteger(input.reelIndex) || !input.monster.reels[input.reelIndex]) {
    errors.push('対象リールを確認してください。');
  }
  if (!CAPACITY_RANKS.some(({ rank }) => rank === input.capacityRank)) {
    errors.push('キャパシティランクをA～Fから指定してください。');
  }
  const startLevel = input.startLevel ?? 1;
  if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 10) {
    errors.push('開始レベルは1～10で指定してください。');
  }
  const tolerance = input.tolerance ?? 1e-6;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    errors.push('収束許容誤差は正の有限値で指定してください。');
  }
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const [name, value] of Object.entries(limits)) {
    const isCountLimit = name === 'maxStates' || name === 'maxEdges';
    const valid = isCountLimit ? Number.isSafeInteger(value) && value > 0 : Number.isFinite(value) && value > 0;
    if (!valid) errors.push(`計算上限 ${name} は正の有限値${isCountLimit ? 'の整数' : ''}で指定してください。`);
  }
  if (errors.length) return { valid: false, status: 'invalid_input', errors };

  const monster = withActualCapacities({
    ...input.monster,
    capacityRank: input.capacityRank,
    capacityIsA: false,
    reels: input.monster.reels.map((reel, index) => ({
      ...reel,
      slots: index === input.reelIndex ? [...input.initialSlots] : [...reel.slots],
      initialSlots: reel.initialSlots ? [...reel.initialSlots] : undefined,
    })),
    skills: [...input.monster.skills],
  });
  errors.push(...validConfiguration(monster, input.reelIndex, input.initialSlots, '初期構成'));
  errors.push(...validConfiguration(monster, input.reelIndex, input.targetSlots, '目標構成'));
  const existingErrors = validate(monster);
  errors.push(...existingErrors.map((message) => `抽選対象となる他リール: ${message}`));
  for (const reel of monster.reels) {
    const cost = slotCost(reel, monster.skills, reel.level);
    if (cost > reel.capacity) {
      errors.push(`抽選対象となる他リール: ★${reel.level}の初期構成がキャパシティ ${reel.capacity} を超えています。`);
    }
  }
  if (errors.length) return { valid: false, status: 'invalid_input', errors: [...new Set(errors)] };

  return {
    valid: true,
    plan: {
      monster,
      reelIndex: input.reelIndex,
      initialSlots: normalizedSlots(input.initialSlots, input.orderMatters ?? false),
      targetSlots: normalizedSlots(input.targetSlots, input.orderMatters ?? false),
      startLevel,
      orderMatters: input.orderMatters ?? false,
      limits,
      tolerance,
    },
  };
}

export function isEvolutionGoal(
  slots: readonly string[],
  targetSlots: readonly string[],
  orderMatters: boolean,
): boolean {
  if (slots.length !== SLOTS || targetSlots.length !== SLOTS) return false;
  const current = normalizedSlots(slots, orderMatters);
  const target = normalizedSlots(targetSlots, orderMatters);
  return current.every((id, index) => id === target[index]);
}

export function evolutionStateKey(state: EvolutionPlanState, orderMatters: boolean): string {
  return JSON.stringify([state.level, normalizedSlots(state.slots, orderMatters)]);
}

/**
 * Enumerates proposals using the current draw model. Proposals on other reels
 * remain in the probability distribution but leave this one-reel state unchanged.
 */
export function evolutionTransitionDistribution(
  plan: PreparedEvolutionPlan,
  state: EvolutionPlanState,
): EvolutionTransitionDistribution {
  const monster: Monster = {
    ...plan.monster,
    reels: plan.monster.reels.map((reel, index) => ({
      ...reel,
      slots: index === plan.reelIndex ? [...state.slots] : [...reel.slots],
    })),
  };
  const outcomes = changeDistribution(monster, { legacy: state.level <= 9 });
  const proposals: EvolutionProposal[] = [];
  const transitions = new Map<string, EvolutionTransitionCandidate>();

  for (const outcome of outcomes) {
    if (outcome.probability <= 0) continue;
    const affectsTargetReel = outcome.set.changes.every((change) => change.reelIndex === plan.reelIndex);
    const nextSlots = [...state.slots];
    if (affectsTargetReel) {
      for (const change of outcome.set.changes) nextSlots[change.slotIndex] = change.to;
    }
    const next: EvolutionPlanState = {
      slots: normalizedSlots(nextSlots, plan.orderMatters),
      level: affectsTargetReel ? Math.min(10, state.level + 1) : state.level,
    };
    const proposal = { set: outcome.set, probability: outcome.probability };
    proposals.push({ ...proposal, next, affectsTargetReel });

    const key = evolutionStateKey(next, plan.orderMatters);
    const existing = transitions.get(key);
    if (existing) {
      existing.probability += outcome.probability;
      existing.proposals.push(proposal);
    } else {
      transitions.set(key, { next, probability: outcome.probability, proposals: [proposal] });
    }
  }

  const proposalProbability = proposals.reduce((sum, proposal) => sum + proposal.probability, 0);
  return {
    proposals,
    transitions: [...transitions.values()],
    proposalProbability,
    noProposalProbability: Math.max(0, 1 - proposalProbability),
  };
}
