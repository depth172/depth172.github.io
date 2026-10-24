import { CAPACITY_RANKS, SLOTS, byCategoryAt, capacityAt, costAt, type Monster } from '../core/types.ts';
import type { SimState } from '../state.ts';
import { STARS, esc, openAttr, skillLabel, tier } from './common.ts';

export function renderSim(m: Monster, sim: SimState, openKeys: ReadonlySet<string>): string {
  const levels = m.reels.map((r) => `<option value="${r.level}"${r.level === sim.level ? ' selected' : ''}>${STARS(r.level)}</option>`).join('');
  const rankOptions = CAPACITY_RANKS
    .map(({ rank, stage }) => `<option value="${rank}"${rank === sim.rank ? ' selected' : ''}>${rank} (${stage}%)</option>`)
    .join('');
	
  const rows = m.skills
    .map(
      (s) => `
				<tr>
					<td>${esc(skillLabel(s, sim.level))}</td>
					<td><input type="number" class="num" min="0" max="${SLOTS}" data-a="sim-min" data-id="${s.id}" value="${sim.min[s.id] ?? 0}"></td>
					<td><input type="number" class="num" min="0" max="${SLOTS}" data-a="sim-max" data-id="${s.id}" value="${sim.max[s.id] ?? (s.kind === 'up' ? SLOTS : 1)}"></td>
				</tr>
			`,
    )
    .join('');
	
  let result = '';
  if (sim.result) {
    const byId = new Map(m.skills.map((s) => [s.id, s]));
    const shown = sim.result.layouts.slice(0, 200);
    const cards = shown
      .map((l, i) => {
        const slots = l.ids
          .map((id) => byId.get(id))
          .sort((a, b) => (a && b ? byCategoryAt(sim.level)(a, b) : 0))
          .map((s) => {
            const c = s ? costAt(s, sim.level) : 0;
            return `<li class="${s ? tier(s, c) : ''}"><span>${esc(s?.name ?? '?')}</span><span class="c">${c}</span></li>`;
          })
          .join('');
        return `<div class="card"><ol class="reel-col">${slots}</ol><div class="total">合計 ${l.cost}</div><button data-a="sim-apply" data-i="${i}">適用</button></div>`;
      })
      .join('');
    result = `<div>${sim.result.layouts.length}通り${sim.result.truncated ? '(上限で打ち切り。条件を絞ってください)' : ''}、上位${shown.length}件を表示(コスト合計の大きい順)</div>
      <div class="cards">${cards}</div>`;
  }
  const selectedRank = CAPACITY_RANKS.find(({ rank }) => rank === sim.rank) ?? CAPACITY_RANKS[0];
  const capacity = capacityAt(m.reels[sim.level - 1].capacity, selectedRank.stage);
  return `<section><h2>構成シミュレーション</h2>
    <div class="row">リール <select data-a="sim-level">${levels}</select>
    個体ランク <select data-a="sim-rank">${rankOptions}</select> キャパ ${capacity}
    <button data-a="sim-run">列挙</button></div>
    <details data-d="sim-filter"${openAttr(openKeys, 'sim-filter')}><summary>絞り込み(各技の最小/最大枠数)</summary><table><tr><th>技</th><th>最小</th><th>最大</th></tr>${rows}</table></details>${result}</section>`;
}
