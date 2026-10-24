import { byCategory, byCategoryAt, CAPACITY_RANKS, capacityAt, costAt, r1, type Monster, type Skill } from '../core/types.ts';
import type { BestState } from '../state.ts';
import { STARS, esc, pct, skillLabel, tier } from './common.ts';

export const bestTargets = (m: Monster): Skill[] => m.skills.filter((s) => s.kind === 'normal' && !s.isMiss).sort(byCategory);

export function renderBest(m: Monster, best: BestState): string {
  const options = bestTargets(m).map((s) => `<option value="${s.id}"${s.id === best.target ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const byId = new Map(m.skills.map((s) => [s.id, s]));
  const results = (best.result ?? [])
    .map((r, ri) => {
      const summary = `<div class="best-result-summary"><b>${r.rank} (${r.stage}%)</b>
        ${r.probability === null ? '' : `${best.turns > 1 ? `期待${(r.expected ?? 0).toFixed(2)}回　` : ''}${best.turns > 1 ? `　${r.perTurn.map((p, k) => `${k + 1}T ${pct(p)}`).join('　')}` : ''}`}
        <button data-a="best-apply" data-i="${ri}">リールに反映</button></div>`;
      if (!r.layouts || r.probability === null) return `<div class="best-result">${summary}<div>構成不可</div></div>`;
      const cards = r.layouts
        .map((ids, i) => {
          const level = m.reels[i].level;
          const list = ids.map((id) => byId.get(id)!).sort(byCategoryAt(level));
          const total = r1(list.reduce((a, s) => a + costAt(s, level), 0));
          const slots = list.map((s) => `<li class="${tier(s, costAt(s, level))}"><span>${esc(skillLabel(s, level))}</span></li>`).join('');
          const minimumRank = CAPACITY_RANKS
            .filter(({ rank }) => rank !== 'A')
            .filter(({ stage }) => total <= capacityAt(m.reels[i].capacity, stage))
            .at(-1)?.rank;
          const rankText = m.capacityIsA
            ? ''
            : minimumRank
              ? `必要ランク: ${minimumRank}`
              : 'コマンド潜在限定';
          const rankClass = minimumRank ? 'fit' : rankText ? 'bad' : '';
          return `<div class="reel"><h3>${STARS(level)}</h3>
            <div class="row reel-summary"><b>${total}</b> / <b>${capacityAt(m.reels[i].capacity, r.stage)}</b></div>
            <div class="row reel-rank ${rankClass}">${rankText || '&nbsp;'}</div>
            <ol class="reel-col edit">${slots}</ol></div>`;
        })
        .join(''); 
      return `<div class="best-result">${summary}<div class="reels">${cards}</div></div>`;
    })
    .join('');
  const startOptions = m.reels.map((r) => `<option value="${r.level}"${r.level === best.start ? ' selected' : ''}>${STARS(r.level)}</option>`).join('');
  return `
		<div>
			<h2>最大確率構成</h2>
			<div class="row">
				狙う技 <select data-a="best-target">${options}</select>
				ターン数 <input type="number" class="num" min="1" max="10" data-a="best-turns" value="${best.turns}">
				開始リール <select data-a="best-start">${startOptions}</select> 
				<button data-a="best-run">計算</button>
			</div>
			${best.result ? `<div class="best-results">${results}</div>` : `<div>入力済みのキャパ・コストで、開始リールから指定ターン数の間に狙う技が実行される期待回数が最大になる構成を求めます。</div>`}
		</div>
	`;
}
