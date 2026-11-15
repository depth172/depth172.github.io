import { client } from './cloud.ts';
import { copyMasterMonster, type MasterMonster, type MasterSkill } from './master.ts';
import { SLOTS, usableAt, type Monster } from './types.ts';

export interface MasterEvolution {
  id: string;
  source_id: string;
  target_id: string;
  method: 'class_change' | 'fusion' | 'other';
  condition: string;
  inheritance: 'inherit' | 'fixed';
  mappings: { from: string; to: string }[];
  replacement: { skillIds: string[]; notes: string };
  notes: string;
}

export async function fetchEvolutions(): Promise<MasterEvolution[]> {
  if (!client) throw new Error('Supabaseが設定されていません。');
  const { data, error } = await client.from('ore_master_evolutions').select('*').order('id');
  if (error) throw new Error(`進化マスター: ${error.message}`);
  return data;
}

export function evolveMonster(
  source: Monster, sourceMaster: MasterMonster, target: MasterMonster,
  skills: readonly MasterSkill[], rule: MasterEvolution, capacities: readonly number[],
  replacement?: { slot: number; skillId: string },
  sourceSkillIds: Readonly<Record<string, string>> = {},
): Monster {
  if (sourceMaster.id !== rule.source_id || target.id !== rule.target_id) throw new Error('進化元または進化先がルールと一致しません。');
  if (source.masterId && source.masterId !== sourceMaster.id) throw new Error('この個体の進化元マスターが一致しません。');
  if (source.reels.length !== sourceMaster.class_level) throw new Error('個体のクラスが進化元マスターと一致しません。');
  const result = copyMasterMonster(target, skills, capacities);
  if (rule.inheritance === 'inherit') {
    if (target.class_level !== source.reels.length + 1) throw new Error('引き継ぎありの進化はクラスが1増える場合のみ対応しています。');
    if (!replacement || !Number.isInteger(replacement.slot) || replacement.slot < 0 || replacement.slot >= SLOTS ||
        !rule.replacement.skillIds.includes(replacement.skillId)) throw new Error('置換する枠と技を選択してください。');
    const newSkill = result.skills.find((skill) => skill.id === replacement.skillId);
    if (!newSkill || !['up', 'charge'].includes(newSkill.kind) || !usableAt(newSkill, source.reels.length, target.class_level)) {
      throw new Error('選択した置換技は進化前の最高リールで使用できません。');
    }
    const mapping = new Map(rule.mappings.map((entry) => [entry.from, entry.to]));
    if (mapping.size !== rule.mappings.length) throw new Error('進化ルールの技対応が重複しています。');
    const targetIds = new Set(result.skills.map((skill) => skill.id));
    const sourceSkills = new Map(source.skills.map((skill) => [skill.id, skill]));
    const masterSourceIds = new Set(sourceMaster.skills.map((skill) => skill.skillId));
    for (let i = 0; i < source.reels.length; i++) {
      const reel = source.reels[i];
      if (reel.slots.length !== SLOTS) throw new Error(`★${i + 1}のリールは6枠必要です。`);
      const slots = reel.slots.map((id, slot) => {
        if (i === source.reels.length - 1 && slot === replacement.slot) return replacement.skillId;
        if (!id) return '';
        if (!sourceSkills.has(id)) throw new Error(`★${i + 1}の${slot + 1}枠目に不明な技があります。`);
        const sourceId = masterSourceIds.has(id) ? id : sourceSkillIds[id];
        if (!sourceId || !masterSourceIds.has(sourceId)) throw new Error(`★${i + 1}の${slot + 1}枠目「${sourceSkills.get(id)!.name}」に対応する進化元の技を選択してください。`);
        const mapped = mapping.get(sourceId) ?? sourceId;
        if (!targetIds.has(mapped)) throw new Error(`★${i + 1}の${slot + 1}枠目「${sourceSkills.get(id)!.name}」は進化先にありません。マスターの技対応を設定してください。`);
        return mapped;
      });
      result.reels[i].slots = slots;
      result.reels[i].initialSlots = [...slots];
    }
  } else if (rule.inheritance !== 'fixed') {
    throw new Error('進化ルールの引き継ぎ設定が不正です。');
  }
  if (source.capacityRank) result.capacityRank = source.capacityRank;
  if (source.capacityIsA !== undefined) result.capacityIsA = source.capacityIsA;
  return result;
}
