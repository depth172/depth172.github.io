import { client } from './cloud.ts';
import { uid } from './store.ts';
import { type Monster, type SkillKind } from './types.ts';

export interface MasterSkill {
  id: string; name: string; kind: SkillKind; is_miss: boolean; default_cost: number | null;
  default_from_level?: number | null; default_cost_by_level?: (number | null)[];
}
export interface MasterReel { capacityMin: number | null; capacityMax: number | null; slots: (string | null)[] }
export interface MasterMonster {
  id: string; name: string; class_level: number;
  skills: { skillId: string; cost: number | null; fromLevel: number | null; costByLevel: (number | null)[] }[];
  reels: MasterReel[];
}
export interface MasterData { skills: MasterSkill[]; monsters: MasterMonster[] }

export async function fetchMaster(): Promise<MasterData> {
  if (!client) throw new Error('Supabaseが設定されていません。');
  const [skills, monsters] = await Promise.all([
    client.from('ore_master_skills').select('*').order('name'),
    client.from('ore_master_monsters').select('*').order('name'),
  ]);
  if (skills.error) throw new Error(`技マスター: ${skills.error.message}`);
  if (monsters.error) throw new Error(`モンスターマスター: ${monsters.error.message}`);
  return { skills: skills.data, monsters: monsters.data };
}

export function copyMasterMonster(master: MasterMonster, skills: readonly MasterSkill[], capacities: readonly number[]): Monster {
  if (master.reels.length !== master.class_level || capacities.length !== master.class_level ||
      master.class_level < 1 || master.class_level > 4) throw new Error('マスターのリール数が不正です。');
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const copiedSkills = master.skills.map((entry) => {
    const skill = byId.get(entry.skillId);
    if (!skill) throw new Error(`技マスターが見つかりません: ${entry.skillId}`);
    const cost = entry.cost ?? skill.default_cost;
    if (cost === null || cost === undefined || !Number.isFinite(cost)) throw new Error(`技「${skill.name}」のコストを設定してください。`);
    if (skill.default_cost_by_level !== undefined && (!Array.isArray(skill.default_cost_by_level) || skill.default_cost_by_level.length !== 4)) {
      throw new Error(`技「${skill.name}」の共通リール別コストを確認してください。マスターDBの移行が必要な場合があります。`);
    }
    const costByLevel: Record<number, number> = {};
    for (let i = 0; i < master.class_level; i++) {
      const value = entry.costByLevel[i] ?? (entry.cost === null ? skill.default_cost_by_level?.[i] : null);
      if (value !== null && value !== undefined) {
        if (!Number.isFinite(value)) throw new Error(`技「${skill.name}」のリール別コストが不正です。`);
        costByLevel[i + 1] = value;
      }
    }
    const fromLevel = entry.fromLevel ?? skill.default_from_level;
    return {
      id: skill.id, name: skill.name, kind: skill.kind, cost,
      ...(skill.is_miss ? { isMiss: true } : {}),
      ...(fromLevel !== null && fromLevel !== undefined ? { fromLevel } : {}),
      ...(Object.keys(costByLevel).length ? { costByLevel } : {}),
    };
  });
  const ids = new Set(copiedSkills.map((s) => s.id));
  const reels = master.reels.map((reel, index) => {
    const capacity = capacities[index];
    if (!Number.isFinite(capacity) || capacity < 0 ||
        (reel.capacityMin !== null && capacity < reel.capacityMin) ||
        (reel.capacityMax !== null && capacity > reel.capacityMax)) throw new Error(`★${index + 1}のキャパシティを範囲内で入力してください。`);
    if (!Array.isArray(reel.slots) || reel.slots.length !== 6 || reel.slots.some((id) => id !== null && !ids.has(id))) {
      throw new Error(`★${index + 1}の固定配置に未登録の技があります。`);
    }
    const slots = reel.slots.map((id) => id ?? '');
    return { level: index + 1, capacity, slots, initialSlots: [...slots], samples: [] };
  });
  return { id: uid(), name: master.name, masterId: master.id, skills: copiedSkills, reels };
}
