import type { Monster, Skill, SkillKind } from '../core/types.ts';
import { KIND_LABEL, STARS, esc, tier } from './common.ts';

function fromSelect(m: Monster, s: Skill, i: number): string {
  const opts = [
    '<option value="">どのリールでも</option>',
    ...m.reels.map((r) => `<option value="${r.level}"${s.fromLevel === r.level ? ' selected' : ''}>${STARS(r.level)}のみ</option>`),
  ];
  return `<span>出現リール</span><select data-a="sk-from" data-i="${i}">${opts.join('')}</select>`;
}

export function renderSkills(m: Monster): string {
  const rows = m.skills
    .map((s, i) => {
      const kinds = (Object.keys(KIND_LABEL) as SkillKind[]).map((k) => `
				<option value="${k}"${k === s.kind ? ' selected' : ''}>${KIND_LABEL[k]}</option>
			`).join('');
      return `
				<div class="skill-row ${tier(s, s.cost)}">
					<div class="skill-name">
						<div class="inner">
							<span>名前</span>
							<input data-a="sk-name" data-i="${i}" value="${esc(s.name)}">
						</div>
						<button data-a="sk-del" data-i="${i}" class="delete-button">削除</button>
					</div>
					<div class="skill-costs">
						<div class="inner">
							<span>基本コスト</span>
							<input type="number" step="0.1" class="num" data-a="sk-cost" data-i="${i}" value="${s.cost}">
						</div>
						<details>
							<summary>コマンドレベル別コスト</summary>
							<table class="level-costs">
							${m.reels.map((r) => `
								<tr>
									<td>${STARS(r.level)}</td>
									<td><input type="number" step="0.1" class="num" placeholder="基本" data-a="sk-lcost" data-i="${i}" data-r="${r.level}" value="${s.costByLevel?.[r.level] ?? ''}"></td>
								</tr>
							`).join('')}
							</table>
						</details>
					</div>
					<div class="skill-details">
						<div class="inner">
							<span>技種別</span>
							<select data-a="sk-kind" data-i="${i}">${kinds}</select>
							${s.kind === 'normal' || s.kind === 'charge' ? '' : fromSelect(m, s, i)}
						</div>
						${s.kind === 'normal' ? `
							<div class="inner">
								<span>ミスとして扱う</span>
								<input type="checkbox" data-a="sk-miss" data-i="${i}"${s.isMiss ? ' checked' : ''}>
							</div>
						` : ''}
					</div>
				</div>
			`;
    })
    .join('');

  return `
		<div class="monster-skills">
			<h2>技設定</h2>
    	<div class="skill-table-scroll">
				<div class="skill-rows">
					${rows}
				</div>
			</div>
			<button data-a="sk-add" class="add-button">技を追加</button>
		</div>`;
}
