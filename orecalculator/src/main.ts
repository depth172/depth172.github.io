import '../../style.css';
import './style.css';
import { openModal } from './ui/modal.ts';
import { applyChange, isChangeValid, pickChange, revertChange } from './core/change.ts';
import { enumerate } from './core/enumerate.ts';
import { optimizeForTarget } from './core/optimize.ts';
import { initCloud, schedulePush, signIn, signOut } from './core/cloud.ts';
import { exportMonster, importMonster, newMonster, newReel, save, syncShiftSkills, uid } from './core/store.ts';
import { CAPACITY_RANKS, SLOTS, byCategoryAt, capacityAt, r1, type Monster, type SkillKind } from './core/types.ts';
import { best, changeLogOf, cur, openSet, pressCountOf, probView, sim, store, ui, type SimState } from './state.ts';
import { renderAuth } from './views/auth.ts';
import { bestTargets, renderBest } from './views/best.ts';
import { renderChange } from './views/change.ts';
import { renderHeader } from './views/header.ts';
import { renderProb } from './views/prob.ts';
import { renderReelSettings, renderReels } from './views/reels.ts';
import { renderMonsterConfig } from './views/mconfig.ts';
import { renderSkills } from './views/skills.ts';

let activeReelSettings: number | null = null;

// 表示側は状態を書き換えないため、描画前に表示用の状態を現在のモンスターに合わせる
function syncViewState(m: Monster): void {
  if (sim.level > m.reels.length) sim.level = 1;
  if (!bestTargets(m).some((s) => s.id === best.target)) {
    best.target = bestTargets(m)[0]?.id ?? '';
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
    change: renderChangeView(m),
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
  			${renderMonsterConfig(m, store.monsters)}${renderSkills(m)}`
  }[ui.activeTab];

  // 再描画でDOMが作り直されるため、同じタブ内ならスクロール位置を引き継ぐ
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

  if (['cap', 'slot', 'sm-add', 'sm-del', 'sm-slot'].includes(a) && !m.reels[r]) return;

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
        m.reels.forEach((rl) => { clear(rl.slots); rl.samples.forEach((s) => clear(s.slots)); });
        sim.result = null;
        return commit();
      }
      case 'sm-add': m.reels[r].samples.push({ slots: new Array<string>(SLOTS).fill('') }); return commit();
      case 'sm-del': m.reels[r].samples.splice(k, 1); return commit();
      case 'cc-run': {
        (store.pressCounts ??= {})[m.id] = pressCountOf(m.id) + 1;
        const c = pickChange(m, { legacy: el.dataset.legacy === '1', forceDouble: ui.forceDouble });
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
      case 'best-run': {
        best.result = optimizeForTarget(m, { target: best.target, turns: best.turns, start: best.start });
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
    case 'select': store.currentId = val; sim.result = null; return commit();
    case 'cc-force-double': ui.forceDouble = checked; return;
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
    case 'best-start': best.start = Number(val); best.result = null; return render();
    case 'prob-start': probView.start = Number(val); return render();
    case 'prob-turns': probView.turns = Math.min(10, Math.max(1, Math.floor(Number(val)) || 1)); return render();
    case 'best-turns': best.turns = Math.min(10, Math.max(1, Math.floor(Number(val)) || 1)); best.result = null; return;
    case 'best-target': best.target = val; best.result = null; return render();
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
initCloud(store, { onRemoteApplied: () => { sim.result = null; render(); }, onChange: renderAuthOnly });
