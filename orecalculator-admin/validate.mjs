const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value) => finite(value) && value >= 0;
const optionalNumber = (value) => value === null || nonnegative(value);
const optionalCost = (value) => value === null || finite(value);

export function validateRecord(type, value) {
  if (!value || typeof value !== 'object' || !uuid(value.id)) return 'IDが不正です。';
  if (type === 'skills') {
    if (typeof value.name !== 'string' || !value.name.trim() || !['normal', 'charge', 'up', 'down'].includes(value.kind) ||
        typeof value.is_miss !== 'boolean' || (value.is_miss && value.kind !== 'normal') ||
        !finite(value.default_cost) ||
        !(value.default_from_level === null || Number.isInteger(value.default_from_level) && value.default_from_level >= 1 && value.default_from_level <= 4) ||
        !Array.isArray(value.default_cost_by_level) || value.default_cost_by_level.length !== 4 ||
        value.default_cost_by_level.some((cost) => !optionalCost(cost))) return '技の名前・種類・ミス設定・標準コスト・出現リールを確認してください。';
  } else if (type === 'monsters') {
    if (typeof value.name !== 'string' || !value.name.trim() || !Number.isInteger(value.class_level) || value.class_level < 1 || value.class_level > 4 ||
        !Array.isArray(value.skills) || !Array.isArray(value.reels) || value.reels.length !== value.class_level) return '名前・クラス・リール数を確認してください。';
    const ids = new Set();
    for (const [index, skill] of value.skills.entries()) {
      const label = `${index + 1}番目の技`;
      if (!skill || typeof skill !== 'object' || !uuid(skill.skillId)) return `${label}: 技を選択してください。`;
      if (ids.has(skill.skillId)) return `${label}: 同じ技が複数登録されています。重複した行を削除してください。`;
      if (!optionalCost(skill.cost)) return `${label}: コスト上書きには有限の数値を入力してください。`;
      if (!Array.isArray(skill.costByLevel) || skill.costByLevel.length !== value.class_level) return `${label}: リール別コストの数がクラスと一致しません。`;
      if (skill.costByLevel.some((cost) => !optionalCost(cost))) return `${label}: リール別コストには有限の数値を入力してください。`;
      if (!(skill.fromLevel === null || Number.isInteger(skill.fromLevel) && skill.fromLevel >= 1 && skill.fromLevel <= value.class_level)) return `${label}: 発生リールには1からクラスまでの整数を入力してください。`;
      ids.add(skill.skillId);
    }
    for (const reel of value.reels) {
      if (!optionalNumber(reel.capacityMin) || !optionalNumber(reel.capacityMax) ||
          (reel.capacityMin !== null && reel.capacityMax !== null && reel.capacityMin > reel.capacityMax)) return 'キャパシティの範囲を確認してください。';
      if (!Array.isArray(reel.slots) || reel.slots.length !== 6 || reel.slots.some((id) => id !== null && !ids.has(id))) return '固定配置は習得可能な技から6枠を設定してください（空欄も可）。';
    }
  } else if (type === 'evolutions') {
    if (!uuid(value.source_id) || !uuid(value.target_id) || value.source_id === value.target_id ||
        !['class_change', 'fusion', 'other'].includes(value.method) || !['inherit', 'fixed'].includes(value.inheritance) ||
        typeof value.condition !== 'string' || typeof value.notes !== 'string' || !Array.isArray(value.mappings) ||
        value.mappings.some((item) => !uuid(item.from) || !uuid(item.to)) ||
        new Set(value.mappings.map((item) => item.from)).size !== value.mappings.length ||
        !value.replacement || typeof value.replacement !== 'object' || !Array.isArray(value.replacement.skillIds) ||
        value.replacement.skillIds.some((id) => !uuid(id)) || typeof value.replacement.notes !== 'string') return '進化元・進化先・条件・技対応を確認してください。';
  } else return '未対応のデータです。';
  return null;
}
