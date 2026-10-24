import { byCategoryAt, costAt, tierOf, usableAt, type Monster, type Skill, type SkillKind } from '../core/types.ts';

export const KIND_LABEL: Record<SkillKind, string> = { normal: '通常', charge: 'ためる', up: '★移動(上昇)', down: '★移動(低下)' };
export const STARS = (n: number) => '★'.repeat(n);

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const pct = (p: number) => (p * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
export const openAttr = (openKeys: ReadonlySet<string>, key: string) => (openKeys.has(key) ? ' open' : '');

/** 移動系(ためる含む)はオレンジ、それ以外はコストで色分け */
export function tier(s: Skill, cost: number): string {
  return tierOf(s, cost);
}

export function skillLabel(s: Skill, level: number): string {
  return `${s.name || '(無名)'} [${costAt(s, level)}]`;
}

export function slotSelect(m: Monster, value: string, attr: string, level: number, blinkTo?: string): string {
  const opts = [...m.skills].sort(byCategoryAt(level)).filter((s) => s.id === value || usableAt(s, level, m.reels.length)).map((s) => `<option value="${s.id}"${s.id === value ? ' selected' : ''}>${esc(skillLabel(s, level))}</option>`);
  const sel = m.skills.find((s) => s.id === value);
  const to = blinkTo ? m.skills.find((s) => s.id === blinkTo) : undefined;
  if (sel && to) {
    const face = (s: Skill, c: string) => `<div class="${tier(s, costAt(s, level))} ${c}"><select tabindex="-1"><option>${esc(skillLabel(s, level))}</option></select></div>`;
    return `<li class="swap">${face(sel, 'a')}${face(to, 'b')}</li>`;
  }
  const cls = sel ? tier(sel, costAt(sel, level)) : 'empty';
  return `<li class="${cls}"><select ${attr}><option value="">--</option>${opts.join('')}</select></li>`;
}
