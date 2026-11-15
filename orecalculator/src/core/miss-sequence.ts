import type { MissPlanChoice, MissPlanPolicy } from './miss-plan.ts';
import { extendTransitions, type TransitionHistory } from './miss-transitions.ts';

export interface SequenceStep { choices: MissPlanChoice[]; probability: number }

export function recommendedSequence(policies: readonly (MissPlanPolicy | null)[], reelIndex: number): SequenceStep[] | null {
  const initial = policies[0];
  if (!initial) return null;
  if (initial.choices.length === 0) return [];
  const steps: SequenceStep[] = [];
  const layouts = new Set<string>();
  const layout = (policy: MissPlanPolicy) => JSON.stringify([...(policy.slots[reelIndex] ?? [])].sort());
  const candidates = (policy: MissPlanPolicy, history: TransitionHistory): { next: number; step: SequenceStep; history: TransitionHistory }[] => {
    const groups = new Map<string, { next: number; step: SequenceStep; history: TransitionHistory }>();
    for (const choice of policy.choices) {
      if (!choice.accept || choice.probability <= 0 || choice.set.changes.some((change) => change.reelIndex !== reelIndex)) continue;
      if (choice.next < -1 || (choice.next >= 0 && !policies[choice.next])) continue;
      const nextHistory = extendTransitions(history, choice.set);
      if (!nextHistory) continue;
      const key = JSON.stringify([choice.next, choice.next === -1 ? [] : nextHistory]);
      const group = groups.get(key) ?? { next: choice.next, step: { choices: [], probability: 0 }, history: nextHistory };
      group.step.choices.push(choice);
      group.step.probability += choice.probability;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.step.probability - a.step.probability);
  };
  const stack = [{ policy: initial, candidates: candidates(initial, []), position: 0 }];
  let examined = 0;
  layouts.add(layout(initial));
  while (stack.length && examined < 20000) {
    const frame = stack[stack.length - 1];
    if (frame.position === frame.candidates.length) {
      layouts.delete(layout(frame.policy));
      stack.pop();
      if (stack.length) steps.pop();
      continue;
    }
    const { next, step, history } = frame.candidates[frame.position++];
    examined++;
    if (next === -1) return [...steps, step];
    const policy = policies[next]!;
    const nextLayout = layout(policy);
    if (layouts.has(nextLayout)) continue;
    layouts.add(nextLayout);
    steps.push(step);
    stack.push({ policy, candidates: candidates(policy, history), position: 0 });
  }
  return null;
}
