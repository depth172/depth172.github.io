import type { Monster } from '../core/types.ts';
import { STARS, esc } from './common.ts';

export function renderMonsterConfig(m: Monster, monsters: readonly Monster[]): string {
	const opts = monsters.map((x) => `<option value="${x.id}"${x.id === m.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
	const cls = [1, 2, 3, 4].map((n) => `<option value="${n}"${n === m.reels.length ? ' selected' : ''}>${STARS(n)}</option>`).join('');
	const capacityIsA = m.capacityIsA ?? false;
	return `
	<div>
		<h2>モンスター選択</h2>
		<div class="monster-select">
			<div class="monster-selector">
				<select data-a="select">${opts}</select>
			</div>
			<div class="monster-buttons">
				<button data-a="new">新規</button>
				<button data-a="dup">複製</button>
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
					コマンド潜在個体?
					<input type="checkbox" data-a="capacity-is-a"${capacityIsA ? ' checked' : ''}>
				</label>
			</div>
		</div>
	</div>`;
}
