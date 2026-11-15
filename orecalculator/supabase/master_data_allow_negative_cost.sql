-- 既存データを保持したまま標準コストの負数を許可する。
alter table public.ore_master_skills
  drop constraint if exists ore_master_skills_default_cost_check;
