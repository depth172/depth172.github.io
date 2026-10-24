import { slotCost } from '../core/calc.ts';
import { estimateCapacity } from '../core/capacity.ts';
import { isChangeValid } from '../core/change.ts';
import { CAPACITY_RANKS, SLOTS, capacityAt, r1, type Monster } from '../core/types.ts';
import type { ChangeEntry } from '../state.ts';
import { STARS, slotSelect } from './common.ts';

function pendingTo(m: Monster, pending: ChangeEntry | null, ri: number, si: number): string | undefined {
  if (!pending || pending.monsterId !== m.id || !isChangeValid(m, pending.set)) return undefined;
  return pending.set.changes.find((c) => c.reelIndex === ri && c.slotIndex === si)?.to;
}

export function renderReels(m: Monster, pending: ChangeEntry | null): string {
  return `<div class="reels">${Array.from({ length: 4 }, (_, ri) => {
      const r = m.reels[ri];
      if (!r) {
        const emptySlots = `<ol class="reel-col edit">${Array.from({ length: SLOTS }, () => '<li class="empty"><span></span></li>').join('')}</ol>`;
        return `<div class="reel disabled" data-r="${ri}" aria-disabled="true"><h3>${STARS(ri + 1)}</h3>
          <div class="row reel-summary">-</div><div class="row reel-rank">&nbsp;</div>${emptySlots}</div>`;
      }
      const total = slotCost(r, m.skills, r.level);
      const capacityIsA = m.capacityIsA ?? false;
      const capacity = capacityAt(r.capacity, capacityIsA ? 100 : 99);
      const hasFullLayout = r.slots.length === SLOTS && r.slots.every((id) => m.skills.some((s) => s.id === id));
      const candidateRanks = CAPACITY_RANKS
        .filter(({ rank }) => rank !== 'A')
        .filter(({ stage }) => total <= capacityAt(r.capacity, stage))
        .map(({ rank }) => rank);
      const minimumRank = candidateRanks.at(-1);
      const slots = `<ol class="reel-col edit">${r.slots.map((v, si) => slotSelect(m, v, `data-a="slot" data-r="${ri}" data-i="${si}"`, r.level, pendingTo(m, pending, ri, si))).join('')}</ol>`;
      const rankText = !hasFullLayout
        ? ''
        : capacityIsA
          ? ''
          : minimumRank
            ? `必要ランク: ${minimumRank}`
            : '実現不可';
      const rankClass = minimumRank ? 'fit' : rankText ? 'bad' : '';
      return `
				<div class="reel" data-r="${ri}">
				<div class="reel-clickable">
					<h3>${STARS(r.level)}</h3>
          <div class="row reel-summary ${total > capacity ? 'bad' : ''}"><b>${total}</b> / <b>${capacity}</b></div>
					<div class="row reel-rank ${rankClass}">${rankText || '&nbsp;'}</div>
				</div>
        ${slots}
				</div>`;
    })
    .join('')}</div>`;
}

export function renderReelSettings(m: Monster, ri: number): string {
  const reel = m.reels[ri];
  if (!reel) return '';
  const estimate = estimateCapacity(reel, m.skills, m.reels.length);
  const samples = reel.samples
    .map(
      (sample, ki) => `<div class="card sample"><ol class="reel-col edit">${sample.slots.map((v, si) => slotSelect(m, v, `data-a="sm-slot" data-r="${ri}" data-k="${ki}" data-i="${si}"`, reel.level)).join('')}</ol>
        合計 ${slotCost(sample, m.skills, reel.level)} <button data-a="sm-del" data-r="${ri}" data-k="${ki}" aria-label="サンプルを削除">×</button></div>`,
    )
    .join('');
  const estimateText = estimate.lower === null
    ? '6枠すべてを入力したサンプルがありません'
    : estimate.unique !== undefined
      ? `推定キャパ: ${estimate.unique}`
      : `推定キャパ: ${estimate.lower} ～ ${estimate.upper === null ? '上限不明' : r1(estimate.upper - 0.2)}`;

  return `
    <div class="capacity-input">キャパシティ(コマンド潜在時)<input type="number" step="0.1" class="num" data-a="cap" data-r="${ri}" value="${reel.capacity}"></div>
    <h3>wikiサンプルからキャパを逆算</h3>
    <div class="capacity-estimate">${estimateText}${estimate.conflict ? ' (サンプル間で範囲が一致しません)' : ''}</div>
    <div class="cards">${samples}</div>
    <button data-a="sm-add" data-r="${ri}">サンプル追加</button>
  `;
}
