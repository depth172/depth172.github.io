-- 既存の技は設定を変更せず、共通の発生リールとコストを追加する。
alter table public.ore_master_skills
  add column if not exists default_from_level integer check (default_from_level between 1 and 4),
  add column if not exists default_cost_by_level jsonb not null default '[null,null,null,null]'::jsonb
    check (jsonb_typeof(default_cost_by_level) = 'array' and jsonb_array_length(default_cost_by_level) = 4);
