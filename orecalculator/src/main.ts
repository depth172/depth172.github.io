import '../../style.css';
import './style.css';
import { openModal } from './ui/modal.ts';
import { applyChange, isChangeValid, pickChange, revertChange } from './core/change.ts';
import { validate } from './core/calc.ts';
import { enumerate } from './core/enumerate.ts';
import { optimizeForTarget } from './core/optimize.ts';
import { initCloud, schedulePush, signIn, signOut } from './core/cloud.ts';
import { exportMonster, importMonster, newMonster, newReel, save, syncShiftSkills, uid } from './core/store.ts';
import { CAPACITY_RANKS, SLOTS, byCategoryAt, capacityAt, capacityRankOf, r1, withActualCapacities, type Monster, type SkillKind } from './core/types.ts';
import { best, changeLogOf, cur, openSet, pressCountOf, probView, sim, store, ui, type SimState } from './state.ts';
import { renderAuth } from './views/auth.ts';
import { bestTargets, renderBest } from './views/best.ts';
import { renderChange } from './views/change.ts';
import { renderHeader } from './views/header.ts';
import { renderProb } from './views/prob.ts';
import { renderReelSettings, renderReels } from './views/reels.ts';
import { renderInitialReels, renderMonsterConfig } from './views/mconfig.ts';
import { renderSkills } from './views/skills.ts';
import { formatMissPlanProgress, renderMissPlan } from './views/miss-plan.ts';
import type { MissPlanProgress, MissPlanResult } from './core/miss-plan.ts';
import { copyMasterMonster, fetchMaster, type MasterData, type MasterMonster } from './core/master.ts';
import { evolveMonster, fetchEvolutions, type MasterEvolution } from './core/evolution.ts';
import { esc } from './views/common.ts';

let activeReelSettings: number | null = null;
let missPlanReel = 0;
let missPlanTarget = 1;
let missPlanResult: MissPlanResult | null = null;
let missPlanProgress: MissPlanProgress | null = null;
let missPlanWorker: Worker | null = null;
let masterData: MasterData | null = null;
let evolutionData: { master: MasterData; rules: MasterEvolution[]; sourceId: string; ruleId: string; candidate: Monster | null; capacities: string[]; slot: string; skillId: string; skillMappings: Record<string, string> } | null = null;

function showMasterCopy(selected?: string): void {
  if (!masterData) return;
  const monster = masterData.monsters.find((m) => m.id === selected) ?? masterData.monsters[0];
  if (!monster) { openModal('マスターから作成', '<p>モンスターマスターが登録されていません。</p>'); return; }
  const options = masterData.monsters.map((m) => `<option value="${esc(m.id)}"${m.id === monster.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  const capacities = monster.reels.map((reel, i) => {
    const exact = reel.capacityMin !== null && reel.capacityMin === reel.capacityMax;
    const range = `下限: ${reel.capacityMin ?? '未設定'} / 上限: ${reel.capacityMax ?? '未設定'}`;
    return `<label>★${i + 1} キャパシティ（${range}）<input type="number" data-master-capacity="${i}" min="${reel.capacityMin ?? 0}" ${reel.capacityMax !== null ? `max="${reel.capacityMax}"` : ''} step="0.1" value="${exact ? reel.capacityMin : ''}" required></label>`;
  }).join('<br>');
  openModal('マスターから作成', `<p>個体はマスターのコピーとして作成します。キャパシティが未確定の場合は仮の値を入力してください。</p>
    <label>モンスター <select data-a="master-select">${options}</select></label><div>${capacities}</div>
    <p>固定配置が未登録の枠は空欄になります。</p><button data-a="master-copy">個体を作成</button>`);
}

async function openMasterCopy(): Promise<void> {
  openModal('マスターから作成', '<p>マスターを読み込み中です…</p>');
  try { masterData = await fetchMaster(); showMasterCopy(); }
  catch (error) { openModal('マスターから作成', `<p class="bad">マスターを読み込めませんでした: ${esc(String(error))}</p>`); }
}

function showEvolution(): void {
  const state = evolutionData;
  if (!state) return;
  const source = state.master.monsters.find((item) => item.id === state.sourceId);
  const rules = state.rules.filter((rule) => rule.source_id === source?.id);
  const rule = rules.find((item) => item.id === state.ruleId);
  const target = state.master.monsters.find((item) => item.id === rule?.target_id);
  const sourceOptions = state.master.monsters.filter((item) => state.rules.some((rule) => rule.source_id === item.id))
    .map((item) => `<option value="${esc(item.id)}"${item.id === state.sourceId ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  const ruleOptions = rules.map((item) => {
    const name = state.master.monsters.find((monster) => monster.id === item.target_id)?.name ?? '不明な進化先';
    const method = { class_change: 'クラスチェンジ', fusion: '合成', other: 'その他' }[item.method] ?? item.method;
    return `<option value="${esc(item.id)}"${item.id === state.ruleId ? ' selected' : ''}>${esc(`${name}（${method}${item.condition ? `: ${item.condition}` : ''}）`)}</option>`;
  }).join('');
  let details = '';
  if (rule && target) {
    const caps = target.reels.map((reel, i) => {
      const exact = reel.capacityMin !== null && reel.capacityMin === reel.capacityMax;
      return `<label>★${i + 1} キャパシティ（下限: ${reel.capacityMin ?? '未設定'} / 上限: ${reel.capacityMax ?? '未設定'}）
        <input type="number" data-evolution-capacity min="${reel.capacityMin ?? 0}" ${reel.capacityMax !== null ? `max="${reel.capacityMax}"` : ''} step="any" value="${esc(String(state.capacities[i] ?? (exact ? reel.capacityMin : '')))}" required></label>`;
    }).join('');
    let replacement = '';
    if (rule.inheritance === 'inherit') {
      const sourceIds = new Set(source?.skills.map((item) => item.skillId));
      const used = new Set(cur().reels.flatMap((reel) => reel.slots).filter(Boolean));
      const unknown = cur().skills.filter((skill) => used.has(skill.id) && !sourceIds.has(skill.id));
      const mappingInputs = unknown.map((skill) => {
        const choices = source?.skills.map((entry) => {
          const masterSkill = state.master.skills.find((item) => item.id === entry.skillId);
          return `<option value="${esc(entry.skillId)}"${state.skillMappings[skill.id] === entry.skillId ? ' selected' : ''}>${esc(masterSkill?.name ?? entry.skillId)}</option>`;
        }).join('') ?? '';
        return `<label>「${esc(skill.name)}」に対応する進化元の技<select data-evolution-map="${esc(skill.id)}"><option value="">選択してください</option>${choices}</select></label>`;
      }).join('');
      const top = cur().reels.at(-1);
      const byId = new Map(cur().skills.map((skill) => [skill.id, skill.name]));
      const slots = (top?.slots ?? []).map((id, i) => `<option value="${i}"${String(i) === state.slot ? ' selected' : ''}>${i + 1}枠目: ${esc(byId.get(id) ?? (id || '未設定'))}</option>`).join('');
      const candidates = rule.replacement.skillIds.map((id) => {
        const skill = state.master.skills.find((item) => item.id === id);
        return `<option value="${esc(id)}"${id === state.skillId ? ' selected' : ''}>${esc(skill?.name ?? `不明な技: ${id}`)}</option>`;
      }).join('');
      replacement = `${mappingInputs ? `<p>個体の技と進化元マスターの技を対応付けてください。置き換える枠の技は未選択でも構いません。</p>${mappingInputs}` : ''}
        <p>進化前の最高リールの1枠を置き換えます。</p>
        <label>置換する枠<select data-evolution-slot><option value="">選択してください</option>${slots}</select></label>
        <label>置換する技<select data-evolution-skill><option value="">選択してください</option>${candidates}</select></label>`;
    }
    details = `<p>引き継ぎ: ${rule.inheritance === 'inherit' ? 'あり（追加リールは固定配置）' : 'なし（全リール固定配置）'}</p>
      ${rule.replacement.notes ? `<p>置換の備考: ${esc(rule.replacement.notes)}</p>` : ''}
      ${rule.notes ? `<p>備考: ${esc(rule.notes)}</p>` : ''}
      ${replacement}<div>${caps}</div><button data-a="evolution-preview">進化結果を確認</button>`;
  } else if (rule) details = '<p class="bad">進化先のマスターが見つかりません。</p>';
  openModal('進化', `<p>進化元の個体を残し、進化後の個体を新たに作成します。</p>
    <label>進化元マスター<select data-a="evolution-source"><option value="">選択してください</option>${sourceOptions}</select></label>
    ${source ? `<label>進化ルール<select data-a="evolution-rule"><option value="">選択してください</option>${ruleOptions}</select></label>${rules.length ? '' : '<p>進化ルールがありません。</p>'}` : ''}
    ${details}`);
}

async function openEvolution(): Promise<void> {
  openModal('進化', '<p>マスターを読み込み中です…</p>');
  try {
    const [master, rules] = await Promise.all([fetchMaster(), fetchEvolutions()]);
    const sourceId = cur().masterId && master.monsters.some((item) => item.id === cur().masterId) ? cur().masterId! : '';
    evolutionData = { master, rules, sourceId, ruleId: '', candidate: null, capacities: [], slot: '', skillId: '', skillMappings: {} };
    showEvolution();
  } catch (error) { openModal('進化', `<p class="bad">マスターを読み込めませんでした: ${esc(String(error))}</p>`); }
}

function previewEvolution(m: Monster): void {
  const state = evolutionData;
  const source = state?.master.monsters.find((item) => item.id === state.sourceId);
  const rule = state?.rules.find((item) => item.id === state.ruleId);
  const target = state?.master.monsters.find((item) => item.id === rule?.target_id);
  if (!state || !source || !rule || !target) { alert('進化元と進化ルールを選択してください。'); return; }
  const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-evolution-capacity]')];
  if (inputs.length !== target.class_level || inputs.some((input) => !input.value.trim() || !input.checkValidity())) {
    alert('すべてのリールのキャパシティを範囲内で入力してください。'); return;
  }
  const slot = document.querySelector<HTMLSelectElement>('[data-evolution-slot]')?.value;
  const skillId = document.querySelector<HTMLSelectElement>('[data-evolution-skill]')?.value;
  state.capacities = inputs.map((input) => input.value);
  state.slot = slot ?? '';
  state.skillId = skillId ?? '';
  state.skillMappings = Object.fromEntries([...document.querySelectorAll<HTMLSelectElement>('[data-evolution-map]')].map((input) => [input.dataset.evolutionMap!, input.value]));
  try {
    const replacement = slot && skillId ? { slot: Number(slot), skillId } : undefined;
    const candidate = evolveMonster(m, source, target, state.master.skills, rule, inputs.map((input) => Number(input.value)), replacement, state.skillMappings);
    state.candidate = candidate;
    const names = new Map(candidate.skills.map((skill) => [skill.id, skill.name]));
    const reels = candidate.reels.map((reel) => `<section><h3>★${reel.level}（キャパシティ ${reel.capacity}）</h3><ol>${reel.slots.map((id) => `<li>${esc(names.get(id) ?? (id || '未設定'))}</li>`).join('')}</ol></section>`).join('');
    openModal('進化結果の確認', `<p>「${esc(m.name)}」から「${esc(candidate.name)}」を作成します。元の個体は残ります。</p>${reels}
      <button data-a="evolution-back">選択に戻る</button> <button data-a="evolution-apply">この結果を作成</button>`);
  } catch (error) { alert(String(error)); }
}

function clearMissPlan(): void {
  missPlanWorker?.terminate();
  missPlanWorker = null;
  missPlanResult = null;
  missPlanProgress = null;
}


// 表示側は状態を書き換えないため、描画前に表示用の状態を現在のモンスターに合わせる
function syncViewState(m: Monster): void {
  if (sim.level > m.reels.length) sim.level = 1;
  if (missPlanReel >= m.reels.length) missPlanReel = 0;
  if (!bestTargets(m).some((s) => s.id === best.target)) {
    best.target = bestTargets(m)[0]?.id ?? '';
    best.result = null;
  }
  if (best.prioritySkill && (best.prioritySkill === best.target || !m.skills.some((s) =>
    s.id === best.prioritySkill && s.kind === 'normal',
  ))) {
    best.prioritySkill = '';
    best.result = null;
  }
  // 編集などで提案時と状態が変わっていたら破棄する
  if (ui.pending && (ui.pending.monsterId !== m.id || !isChangeValid(m, ui.pending.set))) ui.pending = null;
}

function renderChangeView(m: Monster): string {
  return renderChange(m, {
    log: changeLogOf(m.id),
    pending: ui.pending,
    message: ui.changeMsg,
    forceDouble: ui.forceDouble,
    pressCount: pressCountOf(m.id),
  });
}

// 全体を再描画すると入力中の欄が失われるため、ログイン表示だけ差し替える
function renderAuthOnly(): void {
  const el = document.querySelector('#auth');
  if (el) el.innerHTML = renderAuth();
}

const SCROLL_SELECTORS = ['.content-container', '.sub-content-container', '.skill-table-scroll'];
let lastViewKey = '';

function render(): void {
  const m = cur();
  syncViewState(m);
	const subContent = {
    probability: renderProb(m, probView),
    change: `${renderChangeView(m)}${renderMissPlan(m, missPlanReel, missPlanTarget, missPlanResult, missPlanWorker !== null, missPlanProgress)}`,
    best: renderBest(m, best)
  }[ui.activeSubTab];
  const content = {
    reels: `
			${renderReels(m, ui.pending)}
			<div class="sub-content">
				<div class="tabs sub-tabs">
					<button data-a="tab" data-sub-tab="probability" class="${ui.activeSubTab === 'probability' ? 'active' : ''}">選択確率</button>
					<button data-a="tab" data-sub-tab="change" class="${ui.activeSubTab === 'change' ? 'active' : ''}">コマンド変化</button>
					<button data-a="tab" data-sub-tab="best" class="${ui.activeSubTab === 'best' ? 'active' : ''}">理論値シミュ</button>
				</div>
				<div class="sub-content-container">
					${subContent}
				</div>
			</div>
		`,
    monster: `
			${renderMonsterConfig(m, store.monsters)}${renderSkills(m)}${renderInitialReels(m)}`
  }[ui.activeTab];

  // 再描画で details が閉じないよう開閉状態を保持する
  const viewKey = `${ui.activeTab}/${ui.activeSubTab}`;
  const keep = viewKey === lastViewKey;
  const saved = SCROLL_SELECTORS.map((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    return { top: el?.scrollTop ?? 0, left: el?.scrollLeft ?? 0 };
  });
  lastViewKey = viewKey;

  document.querySelector<HTMLDivElement>('#app')!.innerHTML =`
		${renderHeader(m)}
		<main class="content">
			<div class="tabs main-tabs">
				<button data-a="tab" data-main-tab="reels" id="tab-reels" class="${ui.activeTab === 'reels' ? 'active' : ''}">リール</button>
				<button data-a="tab" data-main-tab="monster" id="tab-monster" class="${ui.activeTab === 'monster' ? 'active' : ''}">モンスター</button>
			</div>
			<div class="content-container${ui.activeTab === 'reels' ? ' reels-content-container' : ''}">
				${content}
			</div>
		</main>
	`;

  if (!keep) return;
  SCROLL_SELECTORS.forEach((sel, i) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      el.scrollTop = saved[i].top;
      el.scrollLeft = saved[i].left;
    }
  });
}

function showReelSettings(ri: number): void {
  const reel = cur().reels[ri];
  if (!reel) return;
  activeReelSettings = ri;
  openModal(`キャパシティ設定 (` + `★`.repeat(reel.level) + `)`, renderReelSettings(cur(), ri));
}

function refreshReelSettings(): void {
  if (activeReelSettings === null) return;
  showReelSettings(activeReelSettings);
}

function commit(): void {
  clearMissPlan();
  save(store);
  schedulePush();
  render();
  refreshReelSettings();
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

  if (['cap', 'slot', 'sm-add', 'sm-del', 'sm-slot', 'initial-slot', 'initial-copy'].includes(a) && !m.reels[r]) return;

  if (isClick) {
    switch (a) {
      case 'modal-preview':
        activeReelSettings = null;
        openModal('モーダルの表示確認', '<p>ここに表示したい内容を配置できます。</p>');
        return;
      case 'login': void signIn(); return;
      case 'logout': void signOut(); return;
			case 'tab': {
				const tab = el.dataset.mainTab;
				const subTab = el.dataset.subTab;
				if (tab) ui.activeTab = tab as typeof ui.activeTab;
				if (subTab) ui.activeSubTab = subTab as typeof ui.activeSubTab;
				return render();
			}
			case 'new': { const n = newMonster(undefined, m.reels.length); store.monsters.push(n); store.currentId = n.id; sim.result = null; return commit(); }
      case 'master-open': void openMasterCopy(); return;
      case 'evolution-open': void openEvolution(); return;
      case 'evolution-preview': previewEvolution(m); return;
      case 'evolution-back': if (evolutionData) { evolutionData.candidate = null; showEvolution(); } return;
      case 'evolution-apply': {
        const candidate = evolutionData?.candidate;
        if (!candidate) { alert('進化結果を確認してください。'); return; }
        evolutionData = null;
        store.monsters.push(candidate); store.currentId = candidate.id; sim.result = null;
        document.querySelector<HTMLDialogElement>('#app-modal')?.close();
        return commit();
      }
      case 'master-copy': {
        const selected = document.querySelector<HTMLSelectElement>('[data-a="master-select"]')?.value;
        const master: MasterMonster | undefined = masterData?.monsters.find((item) => item.id === selected);
        if (!master || !masterData) { alert('モンスターマスターを選択してください。'); return; }
        const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-master-capacity]')];
        if (inputs.length !== master.reels.length || inputs.some((input) => !input.value.trim() || !input.checkValidity())) {
          alert('すべてのリールのキャパシティを範囲内で入力してください。'); return;
        }
        try {
          const n = copyMasterMonster(master, masterData.skills, inputs.map((input) => Number(input.value)));
          store.monsters.push(n); store.currentId = n.id; sim.result = null;
          document.querySelector<HTMLDialogElement>('#app-modal')?.close();
          return commit();
        } catch (error) { alert(String(error)); return; }
      }
      case 'dup': { const n = { ...structuredClone(m), id: uid(), name: m.name + ' (コピー)' }; store.monsters.push(n); store.currentId = n.id; sim.result = null; return commit(); }
      case 'del':
        if (store.monsters.length > 1 && confirm(`「${m.name}」を削除しますか?`)) {
          store.monsters = store.monsters.filter((x) => x.id !== m.id);
          if (store.pressCounts) delete store.pressCounts[m.id];
          if (store.changeLogs) delete store.changeLogs[m.id];
          store.currentId = store.monsters[0].id;
          sim.result = null;
          return commit();
        }
        return;
      case 'export': {
        const io = document.querySelector<HTMLTextAreaElement>('#io')!;
        io.classList.remove('hidden');
        io.value = exportMonster(m);
        document.querySelector('#default')!.classList.add('hidden');
        return;
      }
      case 'import':
        document.querySelector('#io')!.classList.remove('hidden');
        document.querySelector('#io-run')!.classList.remove('hidden');
        document.querySelector('#default')!.classList.add('hidden');
        
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
        m.reels.forEach((rl) => { clear(rl.slots); if (rl.initialSlots) clear(rl.initialSlots); rl.samples.forEach((s) => clear(s.slots)); });
        sim.result = null;
        return commit();
      }
      case 'initial-copy': m.reels[r].initialSlots = [...m.reels[r].slots]; return commit();
      case 'initial-apply': {
        if (m.reels.some((reel) => !reel.initialSlots || reel.initialSlots.length !== SLOTS || reel.initialSlots.some((id) => !m.skills.some((skill) => skill.id === id)))) {
          alert('すべてのリールの初期配置を入力してください');
          return;
        }
        const initialErrors = validate({ ...m, reels: m.reels.map((reel) => ({ ...reel, slots: reel.initialSlots! })) });
        if (initialErrors.length) { alert(initialErrors.join('\n')); return; }
        if (!confirm('現在のリールを初期配置で上書きし、変化履歴を削除しますか？')) return;
        m.reels.forEach((reel) => { reel.slots = [...reel.initialSlots!]; });
        if (store.changeLogs) delete store.changeLogs[m.id];
        if (store.pressCounts) delete store.pressCounts[m.id];
        ui.pending = null;
        ui.changeMsg = '';
        return commit();
      }
      case 'sm-add': m.reels[r].samples.push({ slots: new Array<string>(SLOTS).fill('') }); return commit();
      case 'sm-del': m.reels[r].samples.splice(k, 1); return commit();
      case 'cc-run': {
        (store.pressCounts ??= {})[m.id] = pressCountOf(m.id) + 1;
        const c = pickChange(withActualCapacities(m), { legacy: el.dataset.legacy === '1', forceDouble: ui.forceDouble });
        ui.changeMsg = c ? '' : ui.forceDouble ? 'ダブル変化できる組み合わせがありません(ダブル変化はLv9以下のみ)' : '変化できる技がありません(リールが未入力、またはキャパ内に収まる候補がありません)';
        ui.pending = c ? { monsterId: m.id, set: c } : null;
        return commit();
      }
      case 'cc-yes':
        if (ui.pending) {
          applyChange(m, ui.pending.set);
          ((store.changeLogs ??= {})[m.id] ??= []).push(ui.pending.set);
          ui.pending = null;
        }
        return commit();
      case 'cc-no':
        ui.pending = null;
        ui.changeMsg = '変化させませんでした';
        return render();
      case 'cc-undo': {
        const last = store.changeLogs?.[m.id]?.pop();
        if (last) revertChange(m, last);
        ui.changeMsg = '';
        return commit();
      }
      case 'cc-clear':
        if (store.pressCounts) delete store.pressCounts[m.id];
        if (store.changeLogs) delete store.changeLogs[m.id];
        ui.changeMsg = '';
        return commit();
      case 'miss-plan-run': {
        clearMissPlan();
        const worker = new Worker(new URL('./miss-plan.worker.ts', import.meta.url), { type: 'module' });
        missPlanWorker = worker;
        worker.onmessage = (event: MessageEvent<{ type: 'progress'; progress: MissPlanProgress } | { type: 'result'; result: MissPlanResult }>) => {
          if (missPlanWorker !== worker) return;
          if (event.data.type === 'progress') {
            missPlanProgress = event.data.progress;
            const status = document.querySelector<HTMLElement>('#miss-plan-progress');
            if (status) status.textContent = formatMissPlanProgress(event.data.progress);
            return;
          }
          missPlanResult = event.data.result;
          worker.terminate();
          missPlanWorker = null;
          render();
        };
        worker.onerror = (event) => {
          if (missPlanWorker !== worker) return;
          worker.terminate();
          missPlanWorker = null;
          missPlanResult = { status: 'invalid', message: `計算中にエラーが発生しました: ${event.message}` };
          render();
        };
        worker.postMessage({ monster: m, options: { reelIndex: missPlanReel, target: missPlanTarget } });
        return render();
      }
      case 'miss-plan-cancel': clearMissPlan(); return render();
      case 'best-run': {
        best.result = optimizeForTarget(m, {
          target: best.target,
          capacityRank: capacityRankOf(m),
          prioritySkill: best.prioritySkill,
          turns: best.turns,
          start: best.start,
          earlyTurnWeighting: best.earlyTurnWeighting,
        });
        return render();
      }
      case 'sim-run': {
        const reel = m.reels[sim.level - 1];
        const stage = CAPACITY_RANKS.find(({ rank }) => rank === sim.rank)?.stage ?? 100;
        sim.result = enumerate(m.skills, { capacity: capacityAt(reel.capacity, stage), level: reel.level, reelCount: m.reels.length, min: sim.min, max: sim.max });
        return render();
      }
      case 'best-apply': {
        const byId = new Map(m.skills.map((s) => [s.id, s]));
        const layouts = best.result?.[i]?.layouts;
        if (!layouts) return;
        m.reels.forEach((r, k) => {
          r.slots = [...layouts[k]].sort((x, y) => byCategoryAt(r.level)(byId.get(x)!, byId.get(y)!));
        });
        return commit();
      }
      case 'sim-apply': {
        const byId = new Map(m.skills.map((s) => [s.id, s]));
        m.reels[sim.level - 1].slots = [...sim.result!.layouts[i].ids].sort((x, y) => byCategoryAt(sim.level)(byId.get(x)!, byId.get(y)!));
        return commit();
      }
    }
    return;
  }

  switch (a) {
    case 'master-select': showMasterCopy(val); return;
    case 'evolution-source': if (evolutionData) { evolutionData.sourceId = val; evolutionData.ruleId = ''; evolutionData.capacities = []; evolutionData.slot = ''; evolutionData.skillId = ''; evolutionData.skillMappings = {}; showEvolution(); } return;
    case 'evolution-rule': if (evolutionData) { evolutionData.ruleId = val; evolutionData.capacities = []; evolutionData.slot = ''; evolutionData.skillId = ''; showEvolution(); } return;
    case 'select': store.currentId = val; sim.result = null; return commit();
    case 'cc-force-double': ui.forceDouble = checked; return;
    case 'miss-plan-reel': clearMissPlan(); missPlanReel = Number(val); return render();
    case 'miss-plan-target': clearMissPlan(); missPlanTarget = Number(val); return render();
    case 'name': m.name = val; return commit();
    case 'class': if (m.reels.length !== Number(val)) delete m.masterId; resizeReels(m, Number(val)); sim.result = null; return commit();
    case 'capacity-is-a':
      m.capacityIsA = checked;
      if (!checked && m.capacityRank === 'A') delete m.capacityRank;
      best.result = null;
      sim.result = null;
      return commit();
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
    case 'initial-slot': (m.reels[r].initialSlots ??= new Array<string>(SLOTS).fill(''))[i] = val; return commit();
    case 'sm-slot': m.reels[r].samples[k].slots[i] = val; return commit();
    case 'best-start': best.start = Number(val); best.result = null; return render();
    case 'prob-start': probView.start = Number(val); return render();
    case 'prob-turns': probView.turns = Math.min(10, Math.max(1, Math.floor(Number(val)) || 1)); return render();
    case 'best-turns': best.turns = Math.min(10, Math.max(1, Math.floor(Number(val)) || 1)); best.result = null; return;
    case 'best-target': best.target = val; best.result = null; return render();
    case 'best-priority': best.prioritySkill = val; best.result = null; return;
    case 'best-early-weight': best.earlyTurnWeighting = checked; best.result = null; return render();
    case 'capacity-rank': {
      const rank = CAPACITY_RANKS.find(({ rank }) => rank !== 'A' && rank === val)?.rank;
      if (val && !rank) return;
      m.capacityRank = rank;
      m.capacityIsA = false;
      best.result = null;
      sim.result = null;
      return commit();
    }
    case 'sim-level': sim.level = Number(val); sim.result = null; return render();
    case 'sim-rank': sim.rank = val as SimState['rank']; sim.result = null; return render();
    case 'sim-min': sim.min[el.dataset.id!] = num(val); return;
    case 'sim-max': sim.max[el.dataset.id!] = num(val); return;
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const button = target.closest<HTMLElement>('button[data-a]');
  if (button) {
    handle(button, true);
    return;
  }
  if (target.closest('button, input, select, textarea, a, .reel-col')) return;
  const reel = target.closest<HTMLElement>('.reel[data-r]');
  if (reel && !reel.classList.contains('disabled')) showReelSettings(Number(reel.dataset.r));
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

const modal = document.querySelector<HTMLDialogElement>('#app-modal');
modal?.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-a]');
  if (button) handle(button, true);
});
modal?.addEventListener('change', (e) => handle(e.target as HTMLElement, false));
modal?.addEventListener('close', () => { activeReelSettings = null; });
app.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button[data-action]');
  if (t && modal) modal.showModal();
});

render();
initCloud(store, { onRemoteApplied: () => { clearMissPlan(); sim.result = null; render(); }, onChange: renderAuthOnly });
