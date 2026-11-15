const token = document.querySelector('meta[name="admin-token"]').content;
const status = document.querySelector('#status');
const list = document.querySelector('#list');
const editor = document.querySelector('#editor');
const labels = { skills: '技', monsters: 'モンスター', evolutions: '進化' };
const kinds = { normal: '通常', charge: 'ためる', up: '★移動（上昇）', down: '★移動（低下）' };
const methods = { class_change: 'クラスチェンジ', fusion: '合成', other: 'その他' };
let data = { skills: [], monsters: [], evolutions: [] };
let tab = 'skills';
let draft = null;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const options = (items, value, empty = '未設定') => `<option value="">${empty}</option>` + items.map(([id, name]) => `<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(name)}</option>`).join('');
const input = (name, value, type = 'text', extra = '') => `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
const num = (v) => v.trim() === '' ? null : Number(v);
const names = (items) => items.map((item) => [item.id, item.name]);
const field = (form, name) => form.elements.namedItem(name).value;

async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, { method, headers: { 'X-Admin-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function report(message, error = false) {
  status.textContent = message; status.className = error ? 'error' : '';
  const local = editor.querySelector('[data-form-status]');
  if (local) { local.textContent = message; local.className = error ? 'error' : ''; }
}
async function load() {
  const [skills, monsters, evolutions] = await Promise.all(Object.keys(data).map((type) => api(type)));
  data = { skills, monsters, evolutions };
}
function renderList() {
  document.querySelector('#list-title').textContent = `${labels[tab]}一覧`;
  document.querySelectorAll('[data-tab]').forEach((el) => el.setAttribute('aria-current', String(el.dataset.tab === tab)));
  const monsterName = (id) => data.monsters.find((m) => m.id === id)?.name ?? '(不明)';
  list.innerHTML = data[tab].map((item) => `<button type="button" data-edit="${esc(item.id)}">${esc(tab === 'evolutions' ? `${monsterName(item.source_id)} → ${monsterName(item.target_id)}` : item.name)}</button>`).join('') || '<p>登録はありません。</p>';
}
const newReel = () => ({ capacityMin: null, capacityMax: null, slots: Array(6).fill(null) });
function makeDraft() {
  const id = crypto.randomUUID();
  if (tab === 'skills') return { id, name: '', kind: 'normal', is_miss: false, default_cost: null, default_from_level: null, default_cost_by_level: Array(4).fill(null) };
  if (tab === 'monsters') return { id, name: '', class_level: 1, skills: [], reels: [newReel()] };
  return { id, source_id: '', target_id: '', method: 'class_change', condition: '', inheritance: 'inherit', mappings: [], replacement: { skillIds: [], notes: '' }, notes: '' };
}
function skillRows(m) {
  return m.skills.map((skill, i) => {
    const master = data.skills.find((item) => item.id === skill.skillId);
    const defaultLevel = master?.default_from_level == null ? '制限なし' : `★${master.default_from_level}`;
    const defaultCosts = master?.default_cost_by_level?.map((cost, j) => cost == null ? null : `★${j + 1}: ${cost}`).filter(Boolean).join('、') || 'なし';
    return `<div class="skill-row" data-skill-row>
    <div class="inline"><label>${i + 1}番目の技<select name="skill" required>${options(names(data.skills), skill.skillId)}</select></label>
    <label>コスト上書き（空欄は技の標準値）${input('cost', skill.cost ?? '', 'number', 'step="any"')}</label>
    <label>発生リール上書き（空欄は技の標準設定）${input('fromLevel', skill.fromLevel ?? '', 'number', `min="1" max="${m.class_level}" step="1"`)}</label>
    <button type="button" data-remove-skill="${i}">削除</button></div>
    <div class="inline">${Array.from({ length: m.class_level }, (_, j) => `<label>★${j + 1} コスト上書き（空欄は標準設定）${input(`levelCost${j}`, skill.costByLevel[j] ?? '', 'number', 'step="any"')}</label>`).join('')}</div>
    ${master ? `<p class="hint">技の共通設定: 発生リール ${esc(defaultLevel)}、リール別コスト ${esc(defaultCosts)}</p>` : ''}
  </div>`;
  }).join('');
}
function reelRows(m) {
  const available = m.skills.map((s) => data.skills.find((x) => x.id === s.skillId)).filter(Boolean);
  return m.reels.map((r, i) => `<div class="reel"><h3>★${i + 1}</h3>
    <label>キャパ下限${input('min', r.capacityMin ?? '', 'number', 'min="0" step="any"')}</label>
    <label>キャパ上限${input('max', r.capacityMax ?? '', 'number', 'min="0" step="any"')}</label>
    <p class="hint">下限と上限が同じ場合は確定値。空欄は未設定。</p>
    <div>固定配置${r.slots.map((id) => `<select name="slots" aria-label="★${i + 1} 固定配置">${options(names(available), id)}</select>`).join('')}</div>
  </div>`).join('');
}
function renderEditor() {
  document.querySelector('#edit-title').textContent = `${labels[tab]}の編集`;
  if (!draft) { editor.innerHTML = '<p>項目を選択してください。</p>'; return; }
  let content = '';
  if (tab === 'skills') {
    content = `<label>名前${input('name', draft.name, 'text', 'required')}</label><label>種類<select name="kind" required>${options(Object.entries(kinds), draft.kind)}</select></label><label>標準コスト${input('default_cost', draft.default_cost ?? '', 'number', 'step="any" required')}</label><label class="checkbox"><input type="checkbox" name="is_miss"${draft.is_miss ? ' checked' : ''}>ミス扱い</label>
    <fieldset><legend>共通リール設定</legend><p class="hint">発生リールは指定したリールのみに制限します。空欄は制限なし。リール別コストは空欄なら標準コストを使います。</p>
    <label>発生リール${input('default_from_level', draft.default_from_level ?? '', 'number', 'min="1" max="4" step="1"')}</label>
    <div class="inline">${Array.from({ length: 4 }, (_, i) => `<label>★${i + 1} 標準コスト${input(`defaultLevelCost${i}`, draft.default_cost_by_level?.[i] ?? '', 'number', 'step="any"')}</label>`).join('')}</div>
    <div class="actions"><button type="button" data-charge-preset>ためるの共通値を入力</button><button type="button" data-up-preset>★移動の共通値を入力</button></div>
    <p class="hint">★移動は発生リールを入力してから共通値を入力してください。既存の値は上書きしません。</p></fieldset>`;
  } else if (tab === 'monsters') {
    content = `<label>名前${input('name', draft.name, 'text', 'required')}</label><label>クラス<select name="class_level">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === draft.class_level ? ' selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>
    <fieldset><legend>習得可能な技</legend><p class="hint">各進化段階で習得可能な技を登録します。コストは技マスターの標準値を使い、必要な場合だけ上書きします。</p><div>${skillRows(draft)}</div><button type="button" data-add-skill>技を追加</button></fieldset>
    <fieldset><legend>リールと固定配置</legend><p class="hint">固定配置は空欄のまま保存できます。技を追加・選択後、リールに設定してください。</p><div class="reels">${reelRows(draft)}</div></fieldset>`;
  } else {
    content = `<label>進化元<select name="source_id" required>${options(names(data.monsters), draft.source_id)}</select></label>
    <label>進化先<select name="target_id" required>${options(names(data.monsters), draft.target_id)}</select></label>
    <label>方法<select name="method">${options(Object.entries(methods), draft.method)}</select></label>
    <label>条件（合成相手など）${input('condition', draft.condition)}</label>
    <label>引き継ぎ<select name="inheritance">${options([['inherit', '引き継ぎあり'], ['fixed', '引き継ぎなし']], draft.inheritance)}</select></label>
    <fieldset><legend>技の対応</legend><p class="hint">対応を指定しない技はそのまま引き継ぎます。</p>${draft.mappings.map((map, i) => `<div class="map-row inline"><label>進化前<select name="mapFrom">${options(names(data.skills), map.from)}</select></label><label>進化後<select name="mapTo">${options(names(data.skills), map.to)}</select></label><button type="button" data-remove-map="${i}">削除</button></div>`).join('')}<button type="button" data-add-map>対応を追加</button></fieldset>
    <fieldset><legend>最高リールの置換候補</legend><p class="hint">進化先の★移動・ためるから選択します。確率が不明な場合は備考に記載します。</p>${draft.replacement.skillIds.map((id, i) => `<div class="inline"><select name="replacement">${options(names(data.skills.filter((s) => s.kind === 'up' || s.kind === 'charge')), id)}</select><button type="button" data-remove-replacement="${i}">削除</button></div>`).join('')}<button type="button" data-add-replacement>置換候補を追加</button><label>抽選・キャパ制約の備考${input('replacementNotes', draft.replacement.notes)}</label></fieldset>
    <label>その他の備考${input('notes', draft.notes)}</label>`;
  }
  const saved = data[tab].some((x) => x.id === draft.id);
  editor.innerHTML = `<form id="form">${content}<p class="hint">ID: ${esc(draft.id)}</p><div class="actions"><button type="submit">保存</button>${saved && tab === 'monsters' ? '<button type="button" data-duplicate>複製して新規作成</button>' : ''}${saved ? '<button type="button" data-delete>削除</button>' : ''}</div><p data-form-status role="status" aria-live="polite"></p></form>`;
}
function capture() {
  const f = document.querySelector('#form');
  if (!f || !draft) return;
  if (tab === 'skills') Object.assign(draft, { name: field(f, 'name'), kind: field(f, 'kind'), is_miss: f.elements.namedItem('is_miss').checked, default_cost: num(field(f, 'default_cost')), default_from_level: num(field(f, 'default_from_level')), default_cost_by_level: Array.from({ length: 4 }, (_, i) => num(field(f, `defaultLevelCost${i}`))) });
  else if (tab === 'monsters') {
    draft.name = field(f, 'name');
    draft.skills = [...f.querySelectorAll('[data-skill-row]')].map((row) => ({
      skillId: row.querySelector('[name=skill]').value,
      cost: num(row.querySelector('[name=cost]').value),
      fromLevel: num(row.querySelector('[name=fromLevel]').value),
      costByLevel: Array.from({ length: draft.class_level }, (_, i) => num(row.querySelector(`[name=levelCost${i}]`).value)),
    }));
    draft.reels = [...f.querySelectorAll('.reel')].map((row) => ({
      capacityMin: num(row.querySelector('[name=min]').value), capacityMax: num(row.querySelector('[name=max]').value),
      slots: [...row.querySelectorAll('[name=slots]')].map((e) => e.value || null),
    }));
  } else {
    for (const key of ['source_id', 'target_id', 'method', 'condition', 'inheritance', 'notes']) draft[key] = field(f, key);
    draft.mappings = [...f.querySelectorAll('.map-row')].map((row) => ({ from: row.querySelector('[name=mapFrom]').value, to: row.querySelector('[name=mapTo]').value }));
    draft.replacement = { skillIds: [...f.querySelectorAll('[name=replacement]')].map((e) => e.value), notes: field(f, 'replacementNotes') };
  }
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.tab) { tab = button.dataset.tab; draft = null; renderList(); renderEditor(); return; }
    if (button.id === 'new') { draft = makeDraft(); renderEditor(); return; }
    if (button.dataset.edit) { draft = structuredClone(data[tab].find((item) => item.id === button.dataset.edit)); renderEditor(); return; }
    if (!draft || button.type === 'submit') return;
    capture();
    if (button.hasAttribute('data-add-skill')) draft.skills.push({ skillId: '', cost: null, fromLevel: null, costByLevel: Array(draft.class_level).fill(null) });
    else if (button.hasAttribute('data-charge-preset') && tab === 'skills') {
      if (draft.kind !== 'charge') { report('ためるの共通値は、種類を「ためる」にしてから入力してください。', true); return; }
      if (draft.default_from_level !== null || draft.default_cost_by_level.some((cost) => cost !== null)) {
        report('既にリール設定があるため上書きしません。変更する場合は各欄を編集してください。', true); return;
      }
      draft.default_cost_by_level = [1, 1.4, 1.8, null];
      if (draft.default_cost === null) draft.default_cost = 1;
    }
    else if (button.hasAttribute('data-up-preset') && tab === 'skills') {
      if (draft.kind !== 'up' || ![1, 2, 3].includes(draft.default_from_level)) {
        report('種類を「★移動（上昇）」にし、発生リールに1～3を入力してください。', true); return;
      }
      if (draft.default_cost !== null) {
        report('既に標準コストがあるため上書きしません。変更する場合は欄を編集してください。', true); return;
      }
      draft.default_cost = [3, 4, 5][draft.default_from_level - 1];
    }
    else if (button.hasAttribute('data-remove-skill')) draft.skills.splice(Number(button.dataset.removeSkill), 1);
    else if (button.hasAttribute('data-add-map')) draft.mappings.push({ from: '', to: '' });
    else if (button.hasAttribute('data-remove-map')) draft.mappings.splice(Number(button.dataset.removeMap), 1);
    else if (button.hasAttribute('data-add-replacement')) draft.replacement.skillIds.push('');
    else if (button.hasAttribute('data-remove-replacement')) draft.replacement.skillIds.splice(Number(button.dataset.removeReplacement), 1);
    else if (button.hasAttribute('data-duplicate') && tab === 'monsters') {
      draft = { ...structuredClone(draft), id: crypto.randomUUID(), name: `${draft.name} (コピー)` };
      report('複製を作成しました。内容を確認して保存してください。進化ルールは複製されません。');
    }
    else if (button.hasAttribute('data-delete')) {
      if (!confirm('このデータを削除しますか？')) return;
      await api(tab, 'DELETE', { id: draft.id }); draft = null; await load(); renderList(); report('削除しました。');
    }
    renderEditor();
  } catch (error) { report(String(error), true); }
});
editor.addEventListener('change', (event) => {
  if (tab !== 'monsters' || !draft) return;
  if (event.target.name === 'class_level') {
    const level = Number(event.target.value);
    capture();
    if (level < draft.class_level && !confirm('クラスを下げると対象外のリールとコストを削除します。続行しますか？')) { renderEditor(); return; }
    draft.class_level = level;
    draft.reels = Array.from({ length: level }, (_, i) => draft.reels[i] ?? newReel());
    draft.skills.forEach((s) => { s.costByLevel = Array.from({ length: level }, (_, i) => s.costByLevel[i] ?? null); });
    renderEditor();
  } else if (event.target.name === 'skill') { capture(); renderEditor(); }
});
editor.addEventListener('invalid', (event) => {
  if (event.target !== event.target.form?.querySelector(':invalid')) return;
  const label = event.target.closest('label')?.textContent.trim() || '入力項目';
  report(`${label}: ${event.target.validationMessage}`, true);
}, true);
editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    capture();
    if (tab === 'monsters') {
      const seen = new Map();
      for (const [index, skill] of draft.skills.entries()) {
        if (seen.has(skill.skillId)) {
          const name = data.skills.find((item) => item.id === skill.skillId)?.name ?? skill.skillId;
          const row = editor.querySelectorAll('[data-skill-row]')[index];
          row.querySelector('[name=skill]').focus();
          throw new Error(`「${name}」が${seen.get(skill.skillId) + 1}番目と${index + 1}番目に重複しています。不要な行を削除してください。`);
        }
        seen.set(skill.skillId, index);
      }
    }
    await api(tab, 'PUT', draft);
    await load(); renderList(); renderEditor(); report('保存しました。');
  } catch (error) { report(String(error), true); }
});
try { await load(); renderList(); renderEditor(); report('共通マスターを読み込みました。'); }
catch (error) { report(`読み込みに失敗しました: ${String(error)}。SQLが適用済みか確認してください。`, true); }
