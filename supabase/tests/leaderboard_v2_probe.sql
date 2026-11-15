-- Probes for supabase/migrations/20261117000000_leaderboard_v2.sql (weekly window, local boards,
-- per-player stats).
--
-- Run as the `postgres` role after the migrations (init, patches, leaderboard_v2):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leaderboard_v2_probe.sql
-- Each check raises an exception (and stops the script) on failure and prints `ok: ...` on success.
-- Everything runs in one transaction that is rolled back, so the probe users never persist.
-- Run it on a database that has no other players (a scratch or fresh one): the expected boards
-- list exactly the probe players.
--
-- Fixtures (all times are relative to the transaction's now()):
--   probe_a  TH  eros known 150 (first finder), hektor known 100 (first finder), eros wrong answer 0,
--                eris known 300 (first finder) 10 days ago, a quick-look row, patch solves now and 3 days ago.
--   probe_b  US  eros known 100 (not first), hektor candidate 0.
--   probe_c  TH  hektor known 50, 10 days ago only.
--   probe_d  --  eros nothing_correct 20 (no country).
--   probe_e  --  profile, no finds.

begin;

create function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: %: got [%], wanted [%]', label, got, want;
  end if;
  raise notice 'ok: %', label;
end $$;

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000a-0000-4000-8000-00000000000a', 'v2-a@example.invalid', '{"display_name": "probe_a"}'),
  ('0000000b-0000-4000-8000-00000000000b', 'v2-b@example.invalid', '{"display_name": "probe_b"}'),
  ('0000000c-0000-4000-8000-00000000000c', 'v2-c@example.invalid', '{"display_name": "probe_c"}'),
  ('0000000d-0000-4000-8000-00000000000d', 'v2-d@example.invalid', '{"display_name": "probe_d"}'),
  ('0000000e-0000-4000-8000-00000000000e', 'v2-e@example.invalid', '{"display_name": "probe_e"}');

update public.profiles set country = 'TH' where display_name in ('probe_a', 'probe_c');
update public.profiles set country = 'US' where display_name = 'probe_b';

-- record_find is the only way rows are written. Args: user, spot, ra, dec, hpx, x, y, vx, vy,
-- verdict, object, find_key, points, bonus, practice.
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'eros', 1, 1, 1, 1, 1, 1, 1, 'known', 'x', 'object:eros', 100, 50, false);
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'hektor', 1, 1, 1, 1, 1, 1, 1, 'known', 'x', 'object:hektor', 100, 0, false);
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'eros', 1, 1, 1, 1, 1, 1, 1, 'nothing_wrong', null, null, 0, 0, false);
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'eris', 1, 1, 1, 1, 1, 1, 1, 'known', 'x', 'object:eris', 300, 0, false);
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'quicklook', 1, 1, 1, null, null, null, null, 'candidate', null, null, 0, 0, false);
select * from public.record_find('0000000b-0000-4000-8000-00000000000b', 'eros', 1, 1, 1, 1, 1, 1, 1, 'known', 'x', 'object:eros', 100, 50, false);
select * from public.record_find('0000000b-0000-4000-8000-00000000000b', 'hektor', 1, 1, 1, 1, 1, 1, 1, 'candidate', null, null, 0, 0, false);
select * from public.record_find('0000000c-0000-4000-8000-00000000000c', 'hektor', 1, 1, 1, 1, 1, 1, 1, 'known', 'x', 'object:h2', 50, 0, false);
select * from public.record_find('0000000d-0000-4000-8000-00000000000d', 'eros', 1, 1, 1, null, null, null, null, 'nothing_correct', null, 'nothing', 20, 0, false);

-- Move some rows into the past (the probe runs as the owner, which may update finds).
update public.finds set created_at = now() - interval '10 days'
  where spot_slug = 'eris' or user_id = '0000000c-0000-4000-8000-00000000000c';

insert into public.patch_solves (patch_id, user_id, ra, dec, created_at) values
  ('p11-1', '0000000a-0000-4000-8000-00000000000a', 1, 1, now()),
  ('p11-2', '0000000a-0000-4000-8000-00000000000a', 1, 1, now() - interval '3 days');

select pg_temp.expect('fixture: the 5 profiles exist with countries',
  (select string_agg(display_name || ':' || coalesce(country, '-'), ',' order by display_name)
     from public.profiles where display_name like 'probe\_%'),
  'probe_a:TH,probe_b:US,probe_c:TH,probe_d:-,probe_e:-');

-- ---------------------------------------------------------------- country column

do $$
begin
  begin
    update public.profiles set country = 'th' where display_name = 'probe_e';
    raise exception 'FAIL: a lower-case country was stored';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set country = 'THA' where display_name = 'probe_e';
    raise exception 'FAIL: a three-letter country was stored';
  exception when check_violation then null;
  end;
  raise notice 'ok: profiles.country must be two upper-case letters';
end $$;

-- ---------------------------------------------------------------- boards

-- All time, all stages: A 550, B 100, C 50, D 20.
select pg_temp.expect('leaderboard_v2 all time, global',
  (select string_agg(display_name || ':' || rank || ':' || score || ':' || accuracy || ':' || finds, ' ' order by rank)
     from public.leaderboard_v2()),
  'probe_a:1:550:0.750:4 probe_b:2:100:0.500:2 probe_c:3:50:1.000:1 probe_d:4:20:1.000:1');

-- The last 7 days: C (10 days ago) and A's old find drop out.
select pg_temp.expect('leaderboard_v2 weekly window',
  (select string_agg(display_name || ':' || rank || ':' || score || ':' || accuracy || ':' || finds, ' ' order by rank)
     from public.leaderboard_v2(null, now() - interval '7 days')),
  'probe_a:1:250:0.667:3 probe_b:2:100:0.500:2 probe_d:3:20:1.000:1');

select pg_temp.expect('leaderboard_v2 local TH, all time (ranks restart inside the country)',
  (select string_agg(display_name || ':' || rank || ':' || score, ' ' order by rank)
     from public.leaderboard_v2(null, null, 'TH')),
  'probe_a:1:550 probe_c:2:50');

select pg_temp.expect('leaderboard_v2 local, lower-case code and weekly window',
  (select string_agg(display_name || ':' || rank || ':' || score, ' ' order by rank)
     from public.leaderboard_v2(null, now() - interval '7 days', 'th')),
  'probe_a:1:250');

select pg_temp.expect('leaderboard_v2 for one stage (finds = counted submissions there)',
  (select string_agg(display_name || ':' || score || ':' || finds, ' ' order by rank)
     from public.leaderboard_v2('eros')),
  'probe_a:150:2 probe_b:100:1 probe_d:20:1');

select pg_temp.expect('leaderboard_v2 for a country with nobody is empty',
  (select count(*)::text from public.leaderboard_v2(null, null, 'FR')), '0');

-- Limit clamp: p_limit 0 is raised to 1, and the caller's own row is added when further down.
select pg_temp.expect('limit is clamped up to 1 row',
  (select count(*)::text from public.leaderboard_v2(null, null, null, 0)), '1');

select pg_temp.expect('leaderboard_countries, all time',
  (select string_agg(code || ':' || players, ' ' order by players desc, code) from public.leaderboard_countries()),
  'TH:2 US:1');

select pg_temp.expect('leaderboard_countries, weekly (C has no find this week)',
  (select string_agg(code || ':' || players, ' ' order by players desc, code)
     from public.leaderboard_countries(null, now() - interval '7 days')),
  'TH:1 US:1');

select pg_temp.expect('leaderboard_countries for one stage',
  (select string_agg(code || ':' || players, ' ' order by players desc, code) from public.leaderboard_countries('hektor')),
  'TH:2 US:1');

-- The old function is untouched and still ranks the same all-time board.
select pg_temp.expect('the old leaderboard() still answers',
  (select string_agg(display_name || ':' || rank || ':' || score, ' ' order by rank) from public.leaderboard()),
  'probe_a:1:550 probe_b:2:100 probe_c:3:50 probe_d:4:20');

-- The helper that carries user ids is not callable by players.
do $$
begin
  if has_function_privilege('anon', 'public.leaderboard_ranked(text, timestamptz, text)', 'execute')
     or has_function_privilege('authenticated', 'public.leaderboard_ranked(text, timestamptz, text)', 'execute') then
    raise exception 'FAIL: leaderboard_ranked (returns user ids) is callable by anon or authenticated';
  end if;
  if not has_function_privilege('anon', 'public.leaderboard_v2(text, timestamptz, text, int)', 'execute')
     or not has_function_privilege('anon', 'public.leaderboard_countries(text, timestamptz)', 'execute')
     or not has_function_privilege('anon', 'public.player_stats(text)', 'execute') then
    raise exception 'FAIL: a public read function is not callable by anon';
  end if;
  if has_function_privilege('anon', 'public.set_my_country(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_my_country(text)', 'execute') then
    raise exception 'FAIL: set_my_country must be callable by authenticated only';
  end if;
  raise notice 'ok: grants (ranking helper closed; reads open; set_my_country authenticated only)';
end $$;

-- ---------------------------------------------------------------- player_stats

select pg_temp.expect('player_stats for probe_a (case-insensitive name)',
  (select concat_ws(' ', display_name, is_me, country, points, points_week, rank_all, rank_week,
                    classifications, correct, first_finds, patches_solved, active_days, spots_solved)
     from public.player_stats('PROBE_A')),
  'probe_a f TH 550 250 1 1 4 3 3 2 3 {eris,eros,hektor}');

select pg_temp.expect('player_stats for probe_a: member_since and last_active are set, last_active is now',
  (select (member_since is not null and last_active = now())::text from public.player_stats('probe_a')), 'true');

select pg_temp.expect('player_stats for probe_b',
  (select concat_ws(' ', country, points, points_week, rank_all, rank_week, classifications, correct,
                    first_finds, patches_solved, active_days, spots_solved)
     from public.player_stats('probe_b')),
  'US 100 100 2 2 2 1 0 0 1 {eros}');

-- C played only 10 days ago: a rank for all time, none for the week.
select pg_temp.expect('player_stats for probe_c: no weekly rank without weekly points',
  (select concat_ws(' ', points, points_week, rank_all, coalesce(rank_week::text, 'null'), active_days)
     from public.player_stats('probe_c')),
  '50 0 3 null 1');

select pg_temp.expect('player_stats for a player with no finds',
  (select concat_ws(' ', points, coalesce(rank_all::text, 'null'), coalesce(rank_week::text, 'null'),
                    classifications, correct, patches_solved, active_days, coalesce(last_active::text, 'null'),
                    spots_solved)
     from public.player_stats('probe_e')),
  '0 null null 0 0 0 0 null {}');

select pg_temp.expect('player_stats for an unknown name returns nothing',
  (select count(*)::text from public.player_stats('nobody_here')), '0');

-- The ranks in player_stats equal the ranks leaderboard_v2 gives for the same player.
do $$
declare
  n text;
  a bigint; b bigint;
begin
  for n in select display_name from public.profiles where display_name like 'probe\_%' loop
    select rank_all, rank_week into a, b from public.player_stats(n);
    if a is distinct from (select l.rank from public.leaderboard_v2(null, null, null, 200) l where l.display_name = n) then
      raise exception 'FAIL: rank_all of % differs from leaderboard_v2', n;
    end if;
    if b is distinct from (select l.rank from public.leaderboard_v2(null, now() - interval '7 days', null, 200) l where l.display_name = n) then
      raise exception 'FAIL: rank_week of % differs from leaderboard_v2', n;
    end if;
  end loop;
  raise notice 'ok: player_stats ranks equal leaderboard_v2 ranks for every probe player';
end $$;

-- ---------------------------------------------------------------- roles: guests, callers, set_my_country

do $$
declare
  r text;
begin
  -- A guest (anon) can read every public function and sees nobody as "me".
  set local role anon;
  select string_agg(display_name, ',' order by rank) into r from public.leaderboard_v2();
  if r is distinct from 'probe_a,probe_b,probe_c,probe_d' then raise exception 'FAIL: anon leaderboard_v2: %', r; end if;
  if exists (select 1 from public.leaderboard_v2() where is_me) then raise exception 'FAIL: a guest has a "me" row'; end if;
  if (select count(*) from public.leaderboard_countries()) <> 2 then raise exception 'FAIL: anon leaderboard_countries'; end if;
  if (select is_me from public.player_stats('probe_a')) then raise exception 'FAIL: a guest is "me" in player_stats'; end if;
  begin
    perform public.set_my_country('FR');
    raise exception 'FAIL: anon called set_my_country';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.leaderboard_ranked(null, null, null);
    raise exception 'FAIL: anon called leaderboard_ranked';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set country = 'FR';
    raise exception 'FAIL: anon updated profiles';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: anon reads the boards and player_stats, is nobody, and cannot write a country';
end $$;

do $$
declare
  r text;
begin
  -- B is logged in: is_me, and their own row is added when they are further down than the limit.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000b-0000-4000-8000-00000000000b', true);
  perform set_config('request.jwt.claims', '{"sub": "0000000b-0000-4000-8000-00000000000b", "role": "authenticated"}', true);

  select string_agg(display_name || ':' || is_me, ',' order by rank) into r from public.leaderboard_v2(null, null, null, 1);
  if r is distinct from 'probe_a:false,probe_b:true' then raise exception 'FAIL: limit 1 plus my own row: %', r; end if;
  if not (select is_me from public.player_stats('probe_b')) then raise exception 'FAIL: player_stats is_me for the caller'; end if;
  if (select is_me from public.player_stats('probe_a')) then raise exception 'FAIL: player_stats is_me for another player'; end if;

  -- B changes only B's country; a bad value changes nothing.
  perform public.set_my_country(' fr ');
  reset role;
  if (select country from public.profiles where display_name = 'probe_b') is distinct from 'FR' then
    raise exception 'FAIL: set_my_country did not set the caller''s country (trimmed, upper-cased)';
  end if;
  if (select string_agg(display_name || country, ',' order by display_name) from public.profiles
        where country is not null and display_name <> 'probe_b') is distinct from 'probe_aTH,probe_cTH' then
    raise exception 'FAIL: set_my_country touched another player''s row';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000b-0000-4000-8000-00000000000b', true);
  perform public.set_my_country('T');
  perform public.set_my_country('THA');
  perform public.set_my_country('1a');
  perform public.set_my_country('XX');
  perform public.set_my_country('');
  perform public.set_my_country(null);
  begin
    update public.profiles set country = 'DE' where id = '0000000b-0000-4000-8000-00000000000b';
    raise exception 'FAIL: authenticated wrote profiles.country directly';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if (select country from public.profiles where display_name = 'probe_b') is distinct from 'FR' then
    raise exception 'FAIL: a bad country code changed the caller''s country';
  end if;

  -- A caller token with no user (nothing in the session) changes nothing.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.set_my_country('JP');
  reset role;
  if exists (select 1 from public.profiles where country = 'JP') then
    raise exception 'FAIL: set_my_country changed a row for a caller with no user id';
  end if;
  raise notice 'ok: set_my_country sets only the caller''s own row, rejects bad codes and does nothing without a user';
end $$;

-- The board for the new country now shows B (local boards follow the profile country).
select pg_temp.expect('after set_my_country, the FR board lists B',
  (select string_agg(display_name || ':' || rank, ' ') from public.leaderboard_v2(null, null, 'fr')), 'probe_b:1');

-- ---------------------------------------------------------------- no user ids anywhere

do $$
declare
  f text;
  cols text[];
begin
  foreach f in array array['leaderboard_v2', 'leaderboard_countries', 'player_stats'] loop
    select array_agg(a order by a) into cols
    from (select unnest(proargnames) a from pg_proc
          where proname = f and pronamespace = 'public'::regnamespace) x;
    if exists (select 1 from unnest(cols) c where c ~ '(^|_)(id|uid|user)(_|$)' or c ~ 'mail') then
      raise exception 'FAIL: % has an id or email column: %', f, cols;
    end if;
  end loop;
  if (select string_agg(to_jsonb(l)::text || to_jsonb(c)::text, '') from public.leaderboard_v2() l, public.leaderboard_countries() c)
       ~ '[0-9a-f]{8}-[0-9a-f]{4}-' then
    raise exception 'FAIL: a board row contains a uuid';
  end if;
  if (select string_agg(to_jsonb(s)::text, '') from public.player_stats('probe_a') s) ~ '([0-9a-f]{8}-[0-9a-f]{4}-|@)' then
    raise exception 'FAIL: player_stats contains a uuid or an email';
  end if;
  raise notice 'ok: no function returns a user id or an email';
end $$;

rollback;
