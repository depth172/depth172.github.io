import { type Change, type ChangeSet } from '../core/change.ts';
import { costAt, type Monster } from '../core/types.ts';
import type { ChangeEntry } from '../state.ts';
import { STARS, esc, tier } from './common.ts';

export interface ChangeViewProps {
  log: readonly ChangeSet[];
  pending: ChangeEntry | null;
  message: string;
  forceDouble: boolean;
  pressCount: number;
}

export function renderChange(m: Monster, { log, pending, message, forceDouble, pressCount }: ChangeViewProps): string {
  const byId = new Map(m.skills.map((s) => [s.id, s]));
  const chip = (id: string, c: Change) => {
    const s = byId.get(id);
    const label = esc(s?.name || '(無名)');
    const cls = s ? tier(s, costAt(s, c.reelIndex + 1)) : '';
    return `<span class="cc-skill ${cls}">${label}</span>`;
  };
  const describeMsg = (set: ChangeSet) =>
    set.changes.map((c) => `
			<div class="change-row">
				<div class="skill">${chip(c.from, c)}</div>
				<div>が</div>
				<div class="skill">${chip(c.to, c)}</div>
				<div>に</div>
			</div>
		`).join('');
  const rows = log
    .map((set) => `
			<li>${set.changes.map((c) => `
				<div class="change-row">
					<div>${STARS(c.reelIndex + 1)} ${c.slotIndex + 1}列目:</div>
					<div class="skill">${chip(c.from, c)}</div>
					<div>→</div>
					<div class="skill">${chip(c.to, c)}</div>
				</div>
			`).join('')}
			</li>
		`)
    .reverse()
    .join('');
  const ask = pending
    ? `
			<div class="pending-change">
				<div class="pending-set">
					${describeMsg(pending.set)}
				</div>
				<div>
					変化しそうだ！
				</div>
			</div>
			<div class="choose">
				<div class="choose-text">
				技を変化させる？
				</div>
				<div class="choose-buttons">
					<button data-a="cc-yes">はい</button><button data-a="cc-no">いいえ</button>
				</div>
			</div>`
    : '';
  return `
		<div>
			<h2>コマンド変化シミュレーター</h2>
			<div class="row">
				<button data-a="cc-run" data-legacy="0"${pending ? ' disabled' : ''}>バトル終了(Lv10以上)</button>
				<button data-a="cc-run" data-legacy="1"${pending ? ' disabled' : ''}>バトル終了(Lv9以下)</button>
				<button data-a="cc-undo"${log.length ? '' : ' disabled'}>1回戻す</button>
				<button data-a="cc-clear"${log.length ? '' : ' disabled'}>履歴クリア</button>
				<label><input type="checkbox" data-a="cc-force-double"${forceDouble ? ' checked' : ''}>ダブル変化を強制</label>
			</div>
			<div class="pending-container">
				${ask}
				<div class="bad">${esc(message)}</div>
			</div>
			<div>変化ボタンを押した回数: <b>${pressCount}</b></div>
			<ol class="cc-log">
				${rows}
			</ol>
		</div>`;
}
