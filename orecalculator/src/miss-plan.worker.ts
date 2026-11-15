import { planMiss, type MissPlanOptions } from './core/miss-plan.ts';
import type { Monster } from './core/types.ts';

self.onmessage = (event: MessageEvent<{ monster: Monster; options: MissPlanOptions }>) => {
  const result = planMiss(event.data.monster, event.data.options, (progress) => {
    self.postMessage({ type: 'progress', progress });
  });
  self.postMessage({ type: 'result', result });
};
