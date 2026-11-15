-- 共通マスター。管理用キーを持つローカル管理サーバーのみが更新する。
create table if not exists public.ore_master_skills (
  id uuid primary key,
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('normal', 'charge', 'up', 'down')),
  is_miss boolean not null default false,
  default_cost numeric,
  default_from_level integer check (default_from_level between 1 and 4),
  default_cost_by_level jsonb not null default '[null,null,null,null]'::jsonb
    check (jsonb_typeof(default_cost_by_level) = 'array' and jsonb_array_length(default_cost_by_level) = 4),
  check (not is_miss or kind = 'normal')
);

create table if not exists public.ore_master_monsters (
  id uuid primary key,
  name text not null check (length(trim(name)) > 0),
  class_level integer not null check (class_level between 1 and 4),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  reels jsonb not null default '[]'::jsonb check (jsonb_typeof(reels) = 'array')
);

create table if not exists public.ore_master_evolutions (
  id uuid primary key,
  source_id uuid not null references public.ore_master_monsters(id) on delete restrict,
  target_id uuid not null references public.ore_master_monsters(id) on delete restrict,
  method text not null check (method in ('class_change', 'fusion', 'other')),
  condition text not null default '',
  inheritance text not null check (inheritance in ('inherit', 'fixed')),
  mappings jsonb not null default '[]'::jsonb check (jsonb_typeof(mappings) = 'array'),
  replacement jsonb not null default '{}'::jsonb check (jsonb_typeof(replacement) = 'object'),
  notes text not null default '',
  check (source_id <> target_id)
);

alter table public.ore_master_skills enable row level security;
alter table public.ore_master_monsters enable row level security;
alter table public.ore_master_evolutions enable row level security;

revoke all on public.ore_master_skills, public.ore_master_monsters, public.ore_master_evolutions from anon, authenticated;
grant select on public.ore_master_skills, public.ore_master_monsters, public.ore_master_evolutions to anon, authenticated;
grant all on public.ore_master_skills, public.ore_master_monsters, public.ore_master_evolutions to service_role;

drop policy if exists ore_master_skills_read on public.ore_master_skills;
create policy ore_master_skills_read on public.ore_master_skills for select to anon, authenticated using (true);
drop policy if exists ore_master_monsters_read on public.ore_master_monsters;
create policy ore_master_monsters_read on public.ore_master_monsters for select to anon, authenticated using (true);
drop policy if exists ore_master_evolutions_read on public.ore_master_evolutions;
create policy ore_master_evolutions_read on public.ore_master_evolutions for select to anon, authenticated using (true);
