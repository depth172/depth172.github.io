-- 旧形式からの移行。競合する固定配置があれば全体をロールバックする。
begin;

alter table public.ore_master_skills
  add column if not exists default_cost numeric;

do $$
begin
  if exists (
    select 1
    from public.ore_master_monsters m
    cross join lateral jsonb_array_elements(m.reels) r(reel)
    cross join lateral generate_series(0, 5) i
    where r.reel ? 'battleSlots' and r.reel ? 'evolutionSlots'
      and r.reel->'battleSlots'->i <> 'null'::jsonb
      and r.reel->'evolutionSlots'->i <> 'null'::jsonb
      and r.reel->'battleSlots'->i <> r.reel->'evolutionSlots'->i
  ) then
    raise exception 'バトル用と進化用の固定配置が競合しています。確認してから再実行してください。';
  end if;
end $$;

update public.ore_master_monsters m
set reels = coalesce((
  select jsonb_agg(
    case when r.reel ? 'slots' then r.reel
    else (r.reel - 'battleSlots' - 'evolutionSlots') || jsonb_build_object(
      'slots', (select jsonb_agg(
        coalesce(nullif(r.reel->'battleSlots'->i, 'null'::jsonb),
                 r.reel->'evolutionSlots'->i, 'null'::jsonb) order by i)
        from generate_series(0, 5) i))
    end order by r.ordinality)
  from jsonb_array_elements(m.reels) with ordinality r(reel, ordinality)
), '[]'::jsonb)
where exists (select 1 from jsonb_array_elements(m.reels) r where not (r ? 'slots'));

commit;
