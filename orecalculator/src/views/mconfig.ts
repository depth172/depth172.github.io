import { CAPACITY_RANKS, capacityRankOf, type Monster } from '../core/types.ts';
import { STARS, esc, slotSelect } from './common.ts';
import { SLOTS } from '../core/types.ts';

export function renderMonsterConfig(m: Monster, monsters: readonly Monster[]): string {
	const opts = monsters.map((x) => `<option value="${x.id}"${x.id === m.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
	const cls = [1, 2, 3, 4].map((n) => `<option value="${n}"${n === m.reels.length ? ' selected' : ''}>${STARS(n)}</option>`).join('');
	const capacityRank = capacityRankOf(m);
	const capacityIsA = capacityRank === 'A';
	const selectedCapacityRank = capacityIsA ? '' : capacityRank ?? '';
	const capacityRankOptions = CAPACITY_RANKS
		.filter(({ rank }) => rank !== 'A')
		.map(({ rank, stage }) => `<option value="${rank}"${rank === capacityRank ? ' selected' : ''}>${rank} (${stage}%)</option>`)
		.join('');
	return `
	<div>
		<h2>モンスター選択</h2>
		<div class="monster-select">
			<div class="monster-selector">
				<select data-a="select">${opts}</select>
			</div>
			<div class="monster-buttons">
				<button data-a="new">新規</button>
				<button data-a="master-open">マスターから作成</button>
				<button data-a="dup">複製</button>
				<button data-a="evolution-open">進化</button>
				<button data-a="del">削除</button>
				<button data-a="export">JSON出力</button>
				<button data-a="import">JSON読込</button>
			</div>
		</div>
		<textarea id="io" class="hidden" rows="6" placeholder="JSONを貼り付けて「読込実行」"></textarea>
		<button id="io-run" class="hidden" data-a="import-run">読込実行</button>
		<div id="default" class="monster-name-config">
			<div>
				<span>名前</span>
				<input data-a="name" value="${esc(m.name)}">
			</div>
			<div>
				<span>クラス(リール数)</span>
				<select data-a="class">${cls}</select>
			</div>
			<div>
				<label>
					<span>コマンド潜在個体?</span>
					<input type="checkbox" data-a="capacity-is-a"${capacityIsA ? ' checked' : ''}>
				</label>
			</div>
			<div class="${capacityIsA ? 'hidden' : ''}">
				<label>
					<span>キャパシティランク</span>
					<select data-a="capacity-rank">
						<option value=""${selectedCapacityRank === '' ? ' selected' : ''}>未指定</option>
						${capacityRankOptions}
					</select>
				</label>
			</div>
		</div>
	</div>`;
}

export function renderInitialReels(m: Monster): string {
  const reels = m.reels.map((reel, ri) => {
    const slots = reel.initialSlots ?? new Array<string>(SLOTS).fill('');
    return `<div class="card initial-reel"><h3>${STARS(reel.level)}</h3>
      <ol class="reel-col edit">${slots.map((id, si) => slotSelect(m, id, `data-a="initial-slot" data-r="${ri}" data-i="${si}"`, reel.level)).join('')}</ol>
      <button data-a="initial-copy" data-r="${ri}">現在のリールからコピー</button>
    </div>`;
  }).join('');
  return `<section><h2>初期入手時のリール</h2>
    <p>初期状態を個体ごとに保存します。現在のリールとは別に編集できます。</p>
    <div class="cards">${reels}</div>
    <button data-a="initial-apply">初期配置を現在のリールに適用</button>
  </section>`;
}
