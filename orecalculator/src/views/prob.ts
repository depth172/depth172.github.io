import { calcTurns, validate } from '../core/calc.ts';
import { byCategory, type Monster } from '../core/types.ts';
import type { ProbViewState } from '../state.ts';
import { STARS, esc, pct } from './common.ts';

export function renderProb(m: Monster, view: ProbViewState): string {
  const errors = validate(m);
  if (errors.length) return `<div><h2>選択確率</h2>${errors.map((e) => `<div class="bad">${esc(e)}</div>`).join('')}</div>`;
  const startLevel = m.reels.some((r) => r.level === view.start) ? view.start : 1;
  const results = calcTurns(m, startLevel, view.turns);
  const used = m.skills.filter((s) => s.kind !== 'up' && s.kind !== 'down' && m.reels.some((r) => r.slots.includes(s.id))).sort(byCategory);
  const downIds = new Set(m.skills.filter((s) => s.kind === 'down').map((s) => s.id));
  const hasDown = m.reels.some((r) => r.slots.some((id) => downIds.has(id)));
  const rows: { label: string; get: (i: number) => number }[] = used.map((s) => ({
    label: esc(s.name),
    get: (i) => results[i].bySkill.get(s.id) ?? 0,
  }));
  const missCount = used.filter((s) => s.isMiss).length;
  const showMissTotal = (hasDown && missCount >= 1) || missCount >= 2;
  const missTotal = (i: number) => results[i].dropMiss + used.filter((s) => s.isMiss).reduce((a, s) => a + (results[i].bySkill.get(s.id) ?? 0), 0);
  if (hasDown) rows.push({ label: 'ミス(低下5回)', get: (i) => results[i].dropMiss });
  if (showMissTotal) rows.push({ label: 'ミス合計', get: missTotal });
  const desktopRows = rows
    .map(({ label, get }) => {
      return `<tr><td>${label}</td>${results.map((_, i) => `<td class="p">${pct(get(i))}</td>`).join('')}</tr>`;
    })
    .join('');
  const mobileRows = results
    .map((_, i) => `<tr><th>${i + 1}</th>${rows.map(({ get }) => `<td class="p">${pct(get(i))}</td>`).join('')}</tr>`)
    .join('');
  const startOptions = m.reels.map((r) => `<option value="${r.level}"${r.level === startLevel ? ' selected' : ''}>${STARS(r.level)}</option>`).join('');
  return `<div><h2>選択確率(経過ターン別)</h2>
    <div class="row">開始リール <select data-a="prob-start">${startOptions}</select> ターン数 <input type="number" class="num" min="1" max="10" data-a="prob-turns" value="${view.turns}"></div>
    <table class="prob-table prob-table-desktop"><tr><th>技</th>${results.map((_, i) => `<th>${i + 1}ターン目</th>`).join('')}</tr>${desktopRows}</table>
    <table class="prob-table prob-table-mobile"><tr><th>T</th>${rows.map(({ label }) => `<th>${label}</th>`).join('')}</tr>${mobileRows}</table>
    </div>`;
}
