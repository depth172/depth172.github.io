import type { MissPlanProgress, MissPlanResult } from '../core/miss-plan.ts';
import { recommendedSequence, type SequenceStep } from '../core/miss-sequence.ts';
import { costAt, SLOTS, type Monster } from '../core/types.ts';
import { esc, pct, STARS, tier } from './common.ts';

interface SampleSlot { before: string; after: string }

export function missPlanSamples(initialSlots: readonly string[], steps: readonly SequenceStep[], reelIndex: number): SampleSlot[][][] | null {
  if (initialSlots.length !== SLOTS) return null;
  let slots = [...initialSlots];
  const samples: SampleSlot[][][] = [];
  for (const step of steps) {
    const alternatives: SampleSlot[][] = [];
    for (const { set } of step.choices) {
      const sample = slots.map((id) => ({ before: id, after: id }));
      const used = new Set<number>();
      for (const change of set.changes) {
        if (change.reelIndex !== reelIndex) return null;
        const index = slots.findIndex((id, i) => id === change.from && !used.has(i));
        if (index < 0) return null;
        used.add(index);
        sample[index].after = change.to;
      }
      alternatives.push(sample);
    }
    if (!alternatives.length) return null;
    samples.push(alternatives);
    slots = alternatives[0].map((slot) => slot.after);
  }
  return samples;
}

function formatBound(value: number, direction: 'lower' | 'upper', digits: number): string {
  const scale = 10 ** digits;
  const rounded = direction === 'lower' ? Math.floor(value * scale) : Math.ceil(value * scale);
  return (rounded / scale).toFixed(digits);
}

export function formatMissPlanProgress(progress: MissPlanProgress): string {
  const upper = progress.upper === null ? '未確定' : formatBound(progress.upper, 'upper', 4);
  return `展開 ${progress.expanded} 状態 / 発見 ${progress.states} 状態 / ${(progress.elapsedMs / 1000).toFixed(1)} 秒 / 循環を許す場合の期待回数の範囲: ${formatBound(progress.lower, 'lower', 4)} 〜 ${upper}`;
}

export function renderMissPlan(m: Monster, reelIndex: number, target: number, result: MissPlanResult | null, running: boolean, progress: MissPlanProgress | null): string {
  const reels = m.reels.map((r, i) => `<option value="${i}"${i === reelIndex ? ' selected' : ''}>${STARS(r.level)}</option>`).join('');
  let output = '';
  if (result && result.status !== 'ok') output = `<p class="bad">${esc(result.message)}</p>${result.status === 'limit' ? `<p>${esc(formatMissPlanProgress(result.progress))}</p><p>上限が未確定の場合、達成できないことを意味しません。</p>` : ''}`;
  const route = result?.status === 'ok' ? result.route ?? result : result?.status === 'limit' ? result.route : null;
  if (result?.status === 'limit' && !route) {
    output += '<p class="bad">循環のない変化順を探索上限内で見つけられませんでした。到達不能とは限りません。</p>';
  }
  if (route) {
    const steps = recommendedSequence(route.policies, reelIndex);
    if (!steps) {
      output += '<p class="bad">循環のない変化順を探索上限内で見つけられませんでした。到達不能とは限りません。</p>';
    } else if (steps.length === 0) {
      output += '<p>初期状態ですでに目標ミス枠数を達成しています。</p>';
    } else {
      const byId = new Map(m.skills.map((skill) => [skill.id, skill.name || '(無名)']));
      const samples = missPlanSamples(m.reels[reelIndex].initialSlots ?? [], steps, reelIndex);
      if (!samples) {
        output += '<p class="bad">変化手順のリール表示を作成できませんでした。初期配置と変化内容を確認してください。</p>';
      } else {
      const level = m.reels[reelIndex].level;
      const skillById = new Map(m.skills.map((skill) => [skill.id, skill]));
      const label = (id: string) => esc(byId.get(id) ?? id);
      const cards = steps.map((step, index) => {
        const examples = samples[index].map((sample, choiceIndex) => {
          const slots = sample.map(({ before, after }) => {
            const skill = skillById.get(after);
            const cls = skill ? tier(skill, costAt(skill, level)) : '';
            const text = before === after ? label(after) : `<span class="miss-plan-before">${label(before)}</span> → <b>${label(after)}</b>`;
            return `<li class="${cls}${before === after ? '' : ' miss-plan-changed'}">${text}</li>`;
          }).join('');
          const description = step.choices[choiceIndex].set.changes.map((c) => `${label(c.from)} → ${label(c.to)}`).join('、');
          return `<div class="miss-plan-example">${samples[index].length > 1 ? `<div>候補 ${choiceIndex + 1}</div>` : ''}<ol class="reel-col miss-plan-reel" aria-label="${STARS(level)} 変化後のリール例">${slots}</ol><div class="miss-plan-description">${description}</div></div>`;
        }).join('');
        return `<li class="miss-plan-step"><h3>手順 ${index + 1}</h3><div>提案確率: ${pct(step.probability)}</div><div>期待待機: ${(1 / step.probability).toFixed(2)} バトル</div><div class="miss-plan-examples">${examples}</div></li>`;
      }).join('');
      const expected = steps.reduce((sum, step) => sum + 1 / step.probability, 0);
      const heading = result?.status === 'ok'
        ? `配置の繰り返しも許した最適方針の期待バトル回数: <b>${result.expectedBattles.toFixed(2)}</b>（近似値、範囲 ${formatBound(result.lower, 'lower', 6)} 〜 ${formatBound(result.upper, 'upper', 6)}）`
        : `探索上限内で見つかった経路です（最短・最適とは限りません）。`;
      output += `<p>${heading}</p>
        <p>以下の変化だけを順番に採用する場合の期待バトル回数: <b>${expected.toFixed(2)}</b></p>
        <p>対象リール以外を含め、記載されていない変化は拒否します。他リールの提案も抽選に含め、拒否したバトルは期待回数に数えます。</p>
        <p>各リールは変化後の配置例です。赤枠は置き換わる枠を示し、同じ技が複数ある場合の位置は一例です。複数の候補がある手順は、いずれかを採用してください。次の手順は最初の候補を採用した配置例です。</p>
        <p>同じリール配置への戻りや、技の変化が循環する経路は表示しません。別枠であっても同じ技同士の循環は除外します。この手順が最短・最適とは限りません。最初の10回の採用はLv9以下、11回目からはLv10以上の仕様です。</p>
        <ol class="miss-plan-steps">${cards}</ol>`;
      }
    }
  }
  return `<section><h2>ミス入れシミュレーション</h2>
    <p>全リールの初期配置とキャパシティランクを設定してください。初期配置から開始し、採用した変化の最初の10回はLv9以下、11回目からLv10以上の仕様を使います。拒否も1バトルに数えます。状態数が多い場合は計算を中止します。</p>
    <div class="row"><label>対象リール <select data-a="miss-plan-reel">${reels}</select></label>
      <label>目標ミス枠数 <select data-a="miss-plan-target">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === target ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <button data-a="miss-plan-run"${running ? ' disabled' : ''}>期待回数を計算</button></div>
    ${running ? `<p>計算中… <button data-a="miss-plan-cancel">計算を中止</button></p><p id="miss-plan-progress">${progress ? esc(formatMissPlanProgress(progress)) : '探索を開始しています。'}</p>` : output}</section>`;
}
