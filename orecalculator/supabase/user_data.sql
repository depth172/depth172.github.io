-- サイト共通のユーザーデータ表。ツールを増やすときは app の値を増やすだけでよい
create table if not exists public.user_data (
  user_id    uuid not null references auth.users on delete cascade,
  app        text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);

alter table public.user_data enable row level security;

-- 行単位の制限は下の RLS で行う。anon には付与しない
grant select, insert, update, delete on public.user_data to authenticated;

create policy "user_data_select_own" on public.user_data
  for select using (user_id = (select auth.uid()));
create policy "user_data_insert_own" on public.user_data
  for insert with check (user_id = (select auth.uid()));
create policy "user_data_update_own" on public.user_data
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "user_data_delete_own" on public.user_data
  for delete using (user_id = (select auth.uid()));
