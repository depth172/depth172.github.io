import './style.css';
import { calc, slotCost, validate } from './core/calc.ts';
import { CHANGE_LABEL, applyChange, isChangeValid, pickChange, revertChange, type ChangeSet } from './core/change.ts';
import { estimateCapacity } from './core/capacity.ts';
import { enumerate, type EnumResult } from './core/enumerate.ts';
import { exportMonster, importMonster, load, newMonster, newReel, save, syncShiftSkills, uid } from './core/store.ts';
import { CAPACITY_RANKS, SLOTS, byCategory, capacityAt, costAt, r1, tierOf, usableAt, type Monster, type Skill, type SkillKind } from './core/types.ts';

const store = load();
const KIND_LABEL: Record<SkillKind, string> = { normal: '通常', charge: 'ためる', up: '★移動(上昇)', down: '★移動(低下)' };
const STARS = (n: number) => '★'.repeat(n);

interface SimState {
  level: number;
  rank: (typeof CAPACITY_RANKS)[number]['rank'];
  min: Record<string, number>;
  max: Record<string, number>;
  result: EnumResult | null;
}
const sim: SimState = { level: 1, rank: 'A', min: {}, max: {}, result: null };
const changeLog: { monsterId: string; set: ChangeSet }[] = [];
let changeMsg = '';
let forceDouble = false;
let pressCount = 0;
let pending: { monsterId: string; set: ChangeSet } | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cur = (): Monster => store.monsters.find((m) => m.id === store.currentId) ?? store.monsters[0];
// 再描画で details が閉じないよう開閉状態を保持する
const openSet = new Set<string>();
const isOpen = (key: string) => (openSet.has(key) ? ' open' : '');
const pct = (p: number) => (p * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

/** 移動系(ためる含む)はオレンジ、それ以外はコストで色分け */
function tier(s: Skill, cost: number): string {
  return tierOf(s, cost);
}

function skillLabel(s: Skill, level: number): string {
  return `${s.name || '(無名)'} [${costAt(s, level)}]`;
}

function slotSelect(m: Monster, value: string, attr: string, level: number, blinkTo?: string): string {
  const opts = [...m.skills].sort(byCategory).filter((s) => s.id === value || usableAt(s, level, m.reels.length)).map((s) => `<option value="${s.id}"${s.id === value ? ' selected' : ''}>${esc(skillLabel(s, level))}</option>`);
  const sel = m.skills.find((s) => s.id === value);
  const to = blinkTo ? m.skills.find((s) => s.id === blinkTo) : undefined;
  if (sel && to) {
    const face = (s: Skill, c: string) => `<div class="${tier(s, costAt(s, level))} ${c}"><select tabindex="-1"><option>${esc(skillLabel(s, level))}</option></select></div>`;
    return `<li class="swap">${face(sel, 'a')}${face(to, 'b')}</li>`;
  }
  const cls = sel ? tier(sel, costAt(sel, level)) : 'empty';
  return `<li class="${cls}"><select ${attr}><option value="">--</option>${opts.join('')}</select></li>`;
}

function renderHeader(m: Monster): string {
  const opts = store.monsters.map((x) => `<option value="${x.id}"${x.id === m.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  const cls = [1, 2, 3, 4].map((n) => `<option value="${n}"${n === m.reels.length ? ' selected' : ''}>${STARS(n)}</option>`).join('');
  const capacityIsA = m.capacityIsA ?? false;
  return `<section><h2>モンスター</h2>
    <div class="row">
      <select data-a="select">${opts}</select>
      <button data-a="new">新規</button><button data-a="dup">複製</button><button data-a="del">削除</button>
      <button data-a="export">JSON出力</button><button data-a="import">JSON読込</button>
    </div>
    <div class="row">名前 <input data-a="name" value="${esc(m.name)}"> クラス(リール数) <select data-a="class">${cls}</select>
      <label><input type="checkbox" data-a="capacity-is-a"${capacityIsA ? ' checked' : ''}>コマンド潜在個体</label></div>
    <textarea id="io" class="hidden" rows="6" placeholder="JSONを貼り付けて「読込実行」"></textarea>
    <button id="io-run" class="hidden" data-a="import-run">読込実行</button>
  </section>`;
}

function fromSelect(m: Monster, s: Skill, i: number): string {
  const opts = [
    '<option value="">どのリールでも</option>',
    ...m.reels.map((r) => `<option value="${r.level}"${s.fromLevel === r.level ? ' selected' : ''}>${STARS(r.level)}で発生</option>`),
  ];
  return `<select data-a="sk-from" data-i="${i}">${opts.join('')}</select>`;
}

function renderSkills(m: Monster): string {
  const rows = m.skills
    .map((s, i) => {
      const kinds = (Object.keys(KIND_LABEL) as SkillKind[]).map((k) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${KIND_LABEL[k]}</option>`).join('');
      return `<tr><td><input data-a="sk-name" data-i="${i}" value="${esc(s.name)}"></td>
        <td><input type="number" step="0.1" class="num" data-a="sk-cost" data-i="${i}" value="${s.cost}"></td>
        ${m.reels.map((r) => `<td><input type="number" step="0.1" class="num" placeholder="基本" data-a="sk-lcost" data-i="${i}" data-r="${r.level}" value="${s.costByLevel?.[r.level] ?? ''}"></td>`).join('')}
        <td><select data-a="sk-kind" data-i="${i}">${kinds}</select>${s.kind === 'normal' || s.kind === 'charge' ? '' : fromSelect(m, s, i)}</td>
        <td>${s.kind === 'normal' ? `<input type="checkbox" data-a="sk-miss" data-i="${i}"${s.isMiss ? ' checked' : ''}>` : ''}</td>
        <td><button data-a="sk-del" data-i="${i}">×</button></td></tr>`;
    })
    .join('');
  return `<section><h2>技</h2>
    <div class="skill-table-scroll"><table class="skill-table"><thead><tr><th>名前</th><th>コスト(基本)</th>${m.reels.map((r) => `<th>${STARS(r.level)}</th>`).join('')}<th>種別</th><th>ミス</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <button data-a="sk-add">技を追加</button></section>`;
}

function pendingTo(m: Monster, ri: number, si: number): string | undefined {
  const p = pending;
  if (!p || p.monsterId !== m.id || !isChangeValid(m, p.set)) return undefined;
  return p.set.changes.find((c) => c.reelIndex === ri && c.slotIndex === si)?.to;
}

function renderReels(m: Monster): string {
  return `<section><h2>リール</h2><div class="reels">${m.reels
    .map((r, ri) => {
      const total = slotCost(r, m.skills, r.level);
      const capacityIsA = m.capacityIsA ?? false;
      const capacity = capacityAt(r.capacity, capacityIsA ? 100 : 99);
      const rest = r1(capacity - total);
      const hasFullLayout = r.slots.length === SLOTS && r.slots.every((id) => m.skills.some((s) => s.id === id));
      const candidateRanks = CAPACITY_RANKS
        .filter(({ rank }) => rank !== 'A')
        .filter(({ stage }) => total <= capacityAt(r.capacity, stage))
        .map(({ rank }) => rank);
      const minimumRank = candidateRanks.at(-1);
      const slots = `<ol class="reel-col edit">${r.slots.map((v, si) => slotSelect(m, v, `data-a="slot" data-r="${ri}" data-i="${si}"`, r.level, pendingTo(m, ri, si))).join('')}</ol>`;
      const est = estimateCapacity(r, m.skills, m.reels.length);
      const samples = r.samples
        .map(
          (sm, ki) => `<div class="card sample"><ol class="reel-col edit">${sm.slots.map((v, si) => slotSelect(m, v, `data-a="sm-slot" data-r="${ri}" data-k="${ki}" data-i="${si}"`, r.level)).join('')}</ol>
          合計 ${slotCost(sm, m.skills, r.level)} <button data-a="sm-del" data-r="${ri}" data-k="${ki}">×</button></div>`,
        )
        .join('');
      const estText = est.lower === null
        ? '6枠すべてを入力したサンプルがありません'
        : `推定キャパ: ${est.lower} ～ ${est.upper === null ? '上限不明' : r1(est.upper - 0.1)}`;
      return `<div class="reel"><h3>${STARS(r.level)}</h3>
        <div class="row">キャパ(コマ潜)<input type="number" step="0.1" class="num" data-a="cap" data-r="${ri}" value="${r.capacity}"></div>
        <div class="row">コスト合計 <b>${total}</b> / 残り <b class="${rest < 0 ? 'bad' : ''}">${rest}</b></div>
        ${!hasFullLayout
          ? '<div class="row">6枠入力してください</div>'
          : !capacityIsA
            ? `<div class="row ${minimumRank ? 'fit' : 'bad'}">${minimumRank ? `実現可能ランク: ${minimumRank}` : 'コマンド潜在以外で実現不可'}</div>`
            : ''}
        ${slots}
        <details data-d="sample-${ri}"${isOpen(`sample-${ri}`)}><summary>wikiサンプルからキャパを逆算</summary>
					<div class="capacity-estimate">${estText}</div>
					<div class="cards">${samples}</div>
          <button data-a="sm-add" data-r="${ri}">サンプル追加</button>
        </details></div>`;
    })
    .join('')}</div></section>`;
}

function renderProb(m: Monster): string {
  const errors = validate(m);
  if (errors.length) return `<section><h2>実行確率</h2>${errors.map((e) => `<div class="bad">${esc(e)}</div>`).join('')}</section>`;
  const results = m.reels.map((r) => calc(m, r.level));
  const used = m.skills.filter((s) => s.kind !== 'up' && s.kind !== 'down' && m.reels.some((r) => r.slots.includes(s.id))).sort(byCategory);
  const downIds = new Set(m.skills.filter((s) => s.kind === 'down').map((s) => s.id));
  const hasDown = m.reels.some((r) => r.slots.some((id) => downIds.has(id)));
  const head = m.reels.map((r) => `<th>開始 ${STARS(r.level)}</th>`).join('');
  const row = (label: string, get: (i: number) => number) =>
    `<tr><td>${label}</td>${results.map((_, i) => `<td class="p">${pct(get(i))}</td>`).join('')}</tr>`;
  const body = used.map((s) => row(esc(s.name) + (s.isMiss ? '(リール上ミス)' : ''), (i) => results[i].bySkill.get(s.id) ?? 0)).join('');
  const missCount = used.filter((s) => s.isMiss).length;
  const showMissTotal = (hasDown && missCount >= 1) || missCount >= 2;
  const missTotal = (i: number) => results[i].dropMiss + used.filter((s) => s.isMiss).reduce((a, s) => a + (results[i].bySkill.get(s.id) ?? 0), 0);
  return `<section><h2>実行確率(開始リール別)</h2><table><tr><th>技</th>${head}</tr>${body}
    ${hasDown ? row('ミス(低下5回)', (i) => results[i].dropMiss) : ''}${showMissTotal ? row('ミス合計', missTotal) : ''}</table></section>`;
}

function renderSim(m: Monster): string {
  if (sim.level > m.reels.length) sim.level = 1;
  const levels = m.reels.map((r) => `<option value="${r.level}"${r.level === sim.level ? ' selected' : ''}>${STARS(r.level)}</option>`).join('');
  const rankOptions = CAPACITY_RANKS
    .map(({ rank, stage }) => `<option value="${rank}"${rank === sim.rank ? ' selected' : ''}>${rank} (${stage}%)</option>`)
    .join('');
  const rows = m.skills
    .map(
      (s) => `<tr><td>${esc(skillLabel(s, sim.level))}</td>
      <td><input type="number" class="num" min="0" max="${SLOTS}" data-a="sim-min" data-id="${s.id}" value="${sim.min[s.id] ?? 0}"></td>
      <td><input type="number" class="num" min="0" max="${SLOTS}" data-a="sim-max" data-id="${s.id}" value="${sim.max[s.id] ?? (s.kind === 'up' ? SLOTS : 1)}"></td></tr>`,
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
          .sort((a, b) => (a && b ? byCategory(a, b) : 0))
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
    <details data-d="sim-filter"${isOpen('sim-filter')}><summary>絞り込み(各技の最小/最大枠数)</summary><table><tr><th>技</th><th>最小</th><th>最大</th></tr>${rows}</table></details>${result}</section>`;
}

function renderChange(m: Monster): string {
  const byId = new Map(m.skills.map((s) => [s.id, s]));
  const name = (id: string) => esc(byId.get(id)?.name || '(無名)');
  const describe = (set: ChangeSet) =>
    set.changes.map((c) => `${STARS(c.reelIndex + 1)} ${c.slotIndex + 1}枠目: ${name(c.from)} → <b>${name(c.to)}</b>`).join(' / ') + (set.kind === 'up' ? '' : ` 【${CHANGE_LABEL[set.kind]}】`);
  const log = changeLog.filter((e) => e.monsterId === m.id);
  const rows = log
    .map((e, i) => `<li>${i + 1}. ${describe(e.set)}</li>`)
    .reverse()
    .join('');
  // 編集などで提案時と状態が変わっていたら破棄する
  const p = pending;
  if (p && (p.monsterId !== m.id || !isChangeValid(m, p.set))) pending = null;
  const ask = pending
    ? `<div class="row">${describe(pending.set)} に変化できます。変化させますか?
        <button data-a="cc-yes">変化させる</button><button data-a="cc-no">変化させない</button></div>`
    : '';
  return `<section><h2>コマンド変化シミュレーター</h2>
    <div class="row"><button data-a="cc-run" data-legacy="0"${pending ? ' disabled' : ''}>バトル終了(Lv10以上)</button><button data-a="cc-run" data-legacy="1"${pending ? ' disabled' : ''}>バトル終了(Lv9以下)</button><button data-a="cc-undo"${log.length ? '' : ' disabled'}>1回戻す</button>
    <button data-a="cc-clear"${log.length ? '' : ' disabled'}>履歴クリア</button>
    <label><input type="checkbox" data-a="cc-force-double"${forceDouble ? ' checked' : ''}>ダブル変化を強制</label></div>
    ${ask}<div class="bad">${esc(changeMsg)}</div>
    <div>変化ボタンを押した回数: <b>${pressCount}</b></div><ol class="cc-log">${rows}</ol></section>`;
}

function render(): void {
  const m = cur();
  document.querySelector<HTMLDivElement>('#app')!.innerHTML =
    `<h1>オレカバトル2 リール計算ツール</h1>${renderHeader(m)}${renderSkills(m)}${renderReels(m)}${renderProb(m)}${renderChange(m)}${renderSim(m)}`;
}

function commit(): void {
  save(store);
  render();
}

function resizeReels(m: Monster, n: number): void {
  while (m.reels.length < n) m.reels.push(newReel(m.reels.length + 1));
  m.reels.length = n;
  syncShiftSkills(m);
}

const num = (v: string) => (Number.isFinite(Number(v)) && v.trim() !== '' ? r1(Number(v)) : 0);

function handle(el: HTMLElement, isClick: boolean): void {
  const a = el.dataset.a;
  if (!a) return;
  const m = cur();
  const i = Number(el.dataset.i);
  const r = Number(el.dataset.r);
  const k = Number(el.dataset.k);
  const val = (el as HTMLInputElement).value;
  const checked = (el as HTMLInputElement).checked;

  if (isClick) {
    switch (a) {
      case 'new': { const n = newMonster(undefined, m.reels.length); store.monsters.push(n); store.currentId = n.id; sim.result = null; return commit(); }
      case 'dup': { const n = { ...structuredClone(m), id: uid(), name: m.name + ' (コピー)' }; store.monsters.push(n); store.currentId = n.id; sim.result = null; return commit(); }
      case 'del':
        if (store.monsters.length > 1 && confirm(`「${m.name}」を削除しますか?`)) {
          store.monsters = store.monsters.filter((x) => x.id !== m.id);
          store.currentId = store.monsters[0].id;
          sim.result = null;
          return commit();
        }
        return;
      case 'export': {
        const io = document.querySelector<HTMLTextAreaElement>('#io')!;
        io.classList.remove('hidden');
        io.value = exportMonster(m);
        return;
      }
      case 'import':
        document.querySelector('#io')!.classList.remove('hidden');
        document.querySelector('#io-run')!.classList.remove('hidden');
        return;
      case 'import-run':
        try {
          const n = importMonster(document.querySelector<HTMLTextAreaElement>('#io')!.value);
          store.monsters.push(n);
          store.currentId = n.id;
          sim.result = null;
          return commit();
        } catch (e) {
          alert(String(e));
          return;
        }
      case 'sk-add': m.skills.push({ id: uid(), name: '', cost: 0, kind: 'normal' }); return commit();
      case 'sk-del': {
        const id = m.skills[i].id;
        m.skills.splice(i, 1);
        const clear = (arr: string[]) => arr.forEach((v, j) => { if (v === id) arr[j] = ''; });
        m.reels.forEach((rl) => { clear(rl.slots); rl.samples.forEach((s) => clear(s.slots)); });
        sim.result = null;
        return commit();
      }
      case 'sm-add': m.reels[r].samples.push({ slots: new Array<string>(SLOTS).fill('') }); return commit();
      case 'sm-del': m.reels[r].samples.splice(k, 1); return commit();
      case 'cc-run': {
        pressCount++;
        const c = pickChange(m, { legacy: el.dataset.legacy === '1', forceDouble });
        changeMsg = c ? '' : forceDouble ? 'ダブル変化できる組み合わせがありません(ダブル変化はLv9以下のみ)' : '変化できる技がありません(リールが未入力、またはキャパ内に収まる候補がありません)';
        pending = c ? { monsterId: m.id, set: c } : null;
        return render();
      }
      case 'cc-yes':
        if (pending) {
          applyChange(m, pending.set);
          changeLog.push(pending);
          pending = null;
        }
        return commit();
      case 'cc-no':
        pending = null;
        changeMsg = '変化させませんでした';
        return render();
      case 'cc-undo': {
        const idx = changeLog.findLastIndex((e) => e.monsterId === m.id);
        if (idx >= 0) {
          revertChange(m, changeLog[idx].set);
          changeLog.splice(idx, 1);
        }
        changeMsg = '';
        return commit();
      }
      case 'cc-clear':
        pressCount = 0;
        for (let j = changeLog.length - 1; j >= 0; j--) if (changeLog[j].monsterId === m.id) changeLog.splice(j, 1);
        changeMsg = '';
        return render();
      case 'sim-run': {
        const reel = m.reels[sim.level - 1];
        const stage = CAPACITY_RANKS.find(({ rank }) => rank === sim.rank)?.stage ?? 100;
        sim.result = enumerate(m.skills, { capacity: capacityAt(reel.capacity, stage), level: reel.level, reelCount: m.reels.length, min: sim.min, max: sim.max });
        return render();
      }
      case 'sim-apply': {
        const byId = new Map(m.skills.map((s) => [s.id, s]));
        m.reels[sim.level - 1].slots = [...sim.result!.layouts[i].ids].sort((x, y) => byCategory(byId.get(x)!, byId.get(y)!));
        return commit();
      }
    }
    return;
  }

  switch (a) {
    case 'select': store.currentId = val; sim.result = null; return commit();
    case 'cc-force-double': forceDouble = checked; return;
    case 'name': m.name = val; return commit();
    case 'class': resizeReels(m, Number(val)); sim.result = null; return commit();
    case 'capacity-is-a': m.capacityIsA = checked; sim.result = null; return commit();
    case 'sk-name': m.skills[i].name = val; return commit();
    case 'sk-cost': m.skills[i].cost = num(val); return commit();
    case 'sk-lcost': {
      const c = (m.skills[i].costByLevel ??= {});
      if (val.trim() === '') delete c[r]; else c[r] = num(val);
      if (Object.keys(c).length === 0) delete m.skills[i].costByLevel;
      return commit();
    }
    case 'sk-kind': m.skills[i].kind = val as SkillKind; if (val === 'normal') delete m.skills[i].fromLevel; else delete m.skills[i].isMiss; return commit();
    case 'sk-from': if (val === '') delete m.skills[i].fromLevel; else m.skills[i].fromLevel = Number(val); return commit();
    case 'sk-miss': m.skills[i].isMiss = checked; return commit();
    case 'cap': m.reels[r].capacity = num(val); return commit();
    case 'slot': m.reels[r].slots[i] = val; return commit();
    case 'sm-slot': m.reels[r].samples[k].slots[i] = val; return commit();
    case 'sim-level': sim.level = Number(val); sim.result = null; return render();
    case 'sim-rank': sim.rank = val as SimState['rank']; sim.result = null; return render();
    case 'sim-min': sim.min[el.dataset.id!] = num(val); return;
    case 'sim-max': sim.max[el.dataset.id!] = num(val); return;
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button[data-a]');
  if (t) handle(t, true);
});
app.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    const key = d.dataset.d;
    if (key) (d.open ? openSet.add(key) : openSet.delete(key));
  },
  true,
);
app.addEventListener('change', (e) => handle(e.target as HTMLElement, false));

render();
