-- Probes for supabase/migrations/20261118000000_leaderboard_v2.sql (weekly window, local boards,
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
--   probe_f  --  eros wrong answer 0 points (a zero-point player who is still listed on the boards).
--   play_time: probe_a has 600 s today, 300 s 3 days ago, 50 s 6 days ago (in the week), 70 s 7 days ago
--   and 1000 s 10 days ago (outside the week); probe_e is the player who pings add_play_time().

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
  ('0000000e-0000-4000-8000-00000000000e', 'v2-e@example.invalid', '{"display_name": "probe_e"}'),
  ('0000000f-0000-4000-8000-00000000000f', 'v2-f@example.invalid', '{"display_name": "probe_f"}');

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

select * from public.record_find('0000000f-0000-4000-8000-00000000000f', 'eros', 1, 1, 1, 1, 1, 1, 1, 'nothing_wrong', null, null, 0, 0, false);

-- Move some rows into the past (the probe runs as the owner, which may update finds).
update public.finds set created_at = now() - interval '10 days'
  where spot_slug = 'eris' or user_id = '0000000c-0000-4000-8000-00000000000c';

insert into public.patch_solves (patch_id, user_id, ra, dec, created_at) values
  ('p11-1', '0000000a-0000-4000-8000-00000000000a', 1, 1, now()),
  ('p11-2', '0000000a-0000-4000-8000-00000000000a', 1, 1, now() - interval '3 days');

insert into public.play_time (user_id, day, seconds) values
  ('0000000a-0000-4000-8000-00000000000a', (now() at time zone 'UTC')::date, 600),
  ('0000000a-0000-4000-8000-00000000000a', (now() at time zone 'UTC')::date - 3, 300),
  ('0000000a-0000-4000-8000-00000000000a', (now() at time zone 'UTC')::date - 6, 50),
  ('0000000a-0000-4000-8000-00000000000a', (now() at time zone 'UTC')::date - 7, 70),
  ('0000000a-0000-4000-8000-00000000000a', (now() at time zone 'UTC')::date - 10, 1000);

select pg_temp.expect('fixture: the 6 profiles exist with countries',
  (select string_agg(display_name || ':' || coalesce(country, '-'), ',' order by display_name)
     from public.profiles where display_name like 'probe\_%'),
  'probe_a:TH,probe_b:US,probe_c:TH,probe_d:-,probe_e:-,probe_f:-');

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

-- All time, all stages: A 550, B 100, C 50, D 20, F 0 (a wrong answer: listed, with accuracy 0).
select pg_temp.expect('leaderboard_v2 all time, global',
  (select string_agg(display_name || ':' || rank || ':' || score || ':' || accuracy || ':' || finds, ' ' order by rank)
     from public.leaderboard_v2()),
  'probe_a:1:550:0.750:4 probe_b:2:100:0.500:2 probe_c:3:50:1.000:1 probe_d:4:20:1.000:1 probe_f:5:0:0.000:1');

-- The last 7 days: C (10 days ago) and A's old find drop out.
select pg_temp.expect('leaderboard_v2 weekly window',
  (select string_agg(display_name || ':' || rank || ':' || score || ':' || accuracy || ':' || finds, ' ' order by rank)
     from public.leaderboard_v2(null, now() - interval '7 days')),
  'probe_a:1:250:0.667:3 probe_b:2:100:0.500:2 probe_d:3:20:1.000:1 probe_f:4:0:0.000:1');

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
  'probe_a:150:2 probe_b:100:1 probe_d:20:1 probe_f:0:1');

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
  'probe_a:1:550 probe_b:2:100 probe_c:3:50 probe_d:4:20 probe_f:5:0');

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
  if has_function_privilege('anon', 'public.player_spots(text)', 'execute')
     or has_function_privilege('authenticated', 'public.player_spots(text)', 'execute')
     or has_function_privilege('public', 'public.player_spots(text)', 'execute')
     or not has_function_privilege('service_role', 'public.player_spots(text)', 'execute') then
    raise exception 'FAIL: player_spots must be callable by service_role only';
  end if;
  raise notice 'ok: grants (ranking helper closed; reads open; set_my_country authenticated only; player_spots service_role only)';
end $$;

-- ---------------------------------------------------------------- player_stats

select pg_temp.expect('player_stats for probe_a (case-insensitive name)',
  (select concat_ws(' ', display_name, is_me, country, points, points_week, rank_all, rank_week,
                    classifications, correct, first_finds, patches_solved, active_days)
     from public.player_stats('PROBE_A')),
  'probe_a f TH 550 250 1 1 4 3 3 2 3');

-- Dates are day-level: midnight UTC, never the exact moment.
select pg_temp.expect('player_stats dates are truncated to the UTC day',
  (select (member_since = date_trunc('day', member_since) and last_active = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
           and extract(timezone from member_since) = 0)::text
     from public.player_stats('probe_a')), 'true');
select pg_temp.expect('player_stats: last_active is the UTC day of the newest find or patch solve',
  (select (last_active = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')::text from public.player_stats('probe_a')), 'true');
select pg_temp.expect('player_stats: last_active for a player who played 10 days ago',
  (select (last_active = date_trunc('day', (now() - interval '10 days') at time zone 'UTC') at time zone 'UTC')::text
     from public.player_stats('probe_c')), 'true');

select pg_temp.expect('player_stats for probe_b',
  (select concat_ws(' ', country, points, points_week, rank_all, rank_week, classifications, correct,
                    first_finds, patches_solved, active_days)
     from public.player_stats('probe_b')),
  'US 100 100 2 2 2 1 0 0 1');

-- C played only 10 days ago: a rank for all time, none for the week.
select pg_temp.expect('player_stats for probe_c: no weekly rank without weekly points',
  (select concat_ws(' ', points, points_week, rank_all, coalesce(rank_week::text, 'null'), active_days)
     from public.player_stats('probe_c')),
  '50 0 3 null 1');

select pg_temp.expect('player_stats for a player with no finds',
  (select concat_ws(' ', points, coalesce(rank_all::text, 'null'), coalesce(rank_week::text, 'null'),
                    classifications, correct, patches_solved, active_days, coalesce(last_active::text, 'null'))
     from public.player_stats('probe_e')),
  '0 null null 0 0 0 0 null');

-- A zero-point player is on both boards (any find in the period), so their ranks equal the boards' ranks.
select pg_temp.expect('player_stats for probe_f (zero points): ranks equal the boards, not null',
  (select concat_ws(' ', points, points_week, rank_all, rank_week) from public.player_stats('probe_f')),
  '0 0 5 4');
select pg_temp.expect('probe_f is listed with those ranks on leaderboard_v2',
  (select (select l.rank from public.leaderboard_v2(null, null, null, 200) l where l.display_name = 'probe_f')::text
          || ' ' || (select l.rank from public.leaderboard_v2(null, now() - interval '7 days', null, 200) l where l.display_name = 'probe_f')::text),
  '5 4');

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

-- player_stats is public, so it must not say which stages a player solved.
select pg_temp.expect('player_stats has no column with spot slugs',
  (select count(*)::text from pg_proc p, unnest(p.proargnames) a
     where p.proname = 'player_stats' and p.pronamespace = 'public'::regnamespace and a ~ '(spot|slug|stage)'), '0');
select pg_temp.expect('player_spots lists the solved slugs (owner call)',
  (select array_to_string(public.player_spots('PROBE_A'), ',')), 'eris,eros,hektor');
select pg_temp.expect('player_spots: none for a player with nothing, and for an unknown name',
  (select array_length(public.player_spots('probe_e'), 1) is null and array_length(public.player_spots('nobody_here'), 1) is null)::text, 'true');

-- ---------------------------------------------------------------- roles: guests, callers, set_my_country

do $$
declare
  r text;
begin
  -- A guest (anon) can read every public function and sees nobody as "me".
  set local role anon;
  select string_agg(display_name, ',' order by rank) into r from public.leaderboard_v2();
  if r is distinct from 'probe_a,probe_b,probe_c,probe_d,probe_f' then raise exception 'FAIL: anon leaderboard_v2: %', r; end if;
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
    perform public.player_spots('probe_a');
    raise exception 'FAIL: anon called player_spots';
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

  begin
    perform public.player_spots('probe_a');
    raise exception 'FAIL: authenticated called player_spots';
  exception when insufficient_privilege then null;
  end;

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
  perform set_config('request.jwt.claims', '', true);
  perform public.set_my_country('JP');
  reset role;
  if exists (select 1 from public.profiles where country = 'JP') then
    raise exception 'FAIL: set_my_country changed a row for a caller with no user id';
  end if;
  raise notice 'ok: set_my_country sets only the caller''s own row, rejects bad codes and does nothing without a user';
end $$;

do $$
begin
  set local role service_role;
  if array_to_string(public.player_spots('probe_b'), ',') is distinct from 'eros' then
    raise exception 'FAIL: service_role cannot read player_spots';
  end if;
  reset role;
  raise notice 'ok: service_role can call player_spots';
end $$;

-- The board for the new country now shows B (local boards follow the profile country).
select pg_temp.expect('after set_my_country, the FR board lists B',
  (select string_agg(display_name || ':' || rank, ' ') from public.leaderboard_v2(null, null, 'fr')), 'probe_b:1');

-- ---------------------------------------------------------------- play time

do $$
declare
  e constant uuid := '0000000e-0000-4000-8000-00000000000e';
  d constant date := (now() at time zone 'UTC')::date;
  got int;
begin
  -- A guest (anon) cannot call add_play_time; nor can the table be read or written directly.
  if has_function_privilege('anon', 'public.add_play_time(int)', 'execute')
     or has_function_privilege('public', 'public.add_play_time(int)', 'execute')
     or not has_function_privilege('authenticated', 'public.add_play_time(int)', 'execute') then
    raise exception 'FAIL: add_play_time must be callable by authenticated only';
  end if;
  set local role anon;
  begin
    perform public.add_play_time(30);
    raise exception 'FAIL: anon called add_play_time';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  begin
    perform 1 from public.play_time;
    raise exception 'FAIL: authenticated read play_time directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.play_time (user_id, day, seconds) values (e, d - 1, 5000);
    raise exception 'FAIL: authenticated wrote play_time directly';
  exception when insufficient_privilege then null;
  end;

  -- The first ping of the day has no earlier ping: the gap counts as 90, so a huge claim gives 90.
  got := public.add_play_time(100000);
  if got <> 90 then raise exception 'FAIL: first ping with a huge claim credited %, wanted 90', got; end if;
  -- A second ping in the same instant has no elapsed time to credit.
  got := public.add_play_time(60);
  if got <> 0 then raise exception 'FAIL: an immediate second ping credited %, wanted 0', got; end if;

  -- Ping again 10 s after the last one: about 10 s, never the 60 that was claimed.
  reset role;
  update public.play_time set last_ping = now() - interval '10 seconds' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  got := public.add_play_time(60);
  if got <> 10 then raise exception 'FAIL: a ping 10 s after the last credited %, wanted 10', got; end if;

  -- After a long gap the credit is the claim, capped at 90.
  reset role;
  update public.play_time set last_ping = now() - interval '1 hour' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  got := public.add_play_time(60);
  if got <> 60 then raise exception 'FAIL: 60 s after a long gap credited %, wanted 60', got; end if;
  reset role;
  update public.play_time set last_ping = now() - interval '1 hour' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  got := public.add_play_time(500);
  if got <> 90 then raise exception 'FAIL: 500 s after a long gap credited %, wanted 90', got; end if;

  -- Negative, zero and null claims credit nothing (and never subtract).
  reset role;
  update public.play_time set last_ping = now() - interval '1 hour' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  if public.add_play_time(-50) <> 0 or public.add_play_time(0) <> 0 or public.add_play_time(null) <> 0 then
    raise exception 'FAIL: a negative, zero or null claim credited something';
  end if;
  reset role;
  if (select seconds from public.play_time where user_id = e and day = d) <> 90 + 10 + 60 + 90 then
    raise exception 'FAIL: the day total is % (wanted 250)', (select seconds from public.play_time where user_id = e and day = d);
  end if;

  -- The day never exceeds 86400.
  update public.play_time set seconds = 86395, last_ping = now() - interval '1 hour' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  got := public.add_play_time(90);
  if got <> 5 then raise exception 'FAIL: near the day cap credited %, wanted 5', got; end if;
  reset role;
  update public.play_time set last_ping = now() - interval '1 hour' where user_id = e and day = d;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000e-0000-4000-8000-00000000000e', true);
  got := public.add_play_time(90);
  if got <> 0 then raise exception 'FAIL: at the day cap credited %, wanted 0', got; end if;
  reset role;
  if (select seconds from public.play_time where user_id = e and day = d) <> 86400 then
    raise exception 'FAIL: the day total is not capped at 86400';
  end if;

  -- A caller with no user (no sub) is a guest: nothing credited, nothing written.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if public.add_play_time(60) <> 0 then raise exception 'FAIL: a caller with no user was credited'; end if;
  reset role;

  -- Only the caller's own row was ever touched.
  if (select count(*) from public.play_time where user_id not in (e, '0000000a-0000-4000-8000-00000000000a')) <> 0 then
    raise exception 'FAIL: add_play_time created a row for another player';
  end if;
  if (select sum(seconds) from public.play_time where user_id = '0000000a-0000-4000-8000-00000000000a') <> 2020 then
    raise exception 'FAIL: add_play_time changed another player''s play time';
  end if;
  raise notice 'ok: add_play_time (first ping 90, 10 s gap gives 10, long gap capped at 90, clamps, day cap 86400, guests, own row only)';
end $$;

-- The first ping of a UTC day measures from the latest ping on the previous days (fake the earlier
-- row), and counts as 90 only when there is no earlier ping within two days.
do $$
declare
  f constant uuid := '0000000f-0000-4000-8000-00000000000f';
  d constant date := (now() at time zone 'UTC')::date;
  got int;
begin
  insert into public.play_time (user_id, day, seconds, last_ping) values (f, d - 1, 100, now() - interval '3 seconds');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f::text, true);
  got := public.add_play_time(60);
  if got <> 3 then raise exception 'FAIL: first ping of the day, 3 s after a ping on the previous day, credited %, wanted 3', got; end if;
  reset role;
  if (select last_ping from public.play_time where user_id = f and day = d) < now() then
    raise exception 'FAIL: last_ping is earlier than the transaction start';
  end if;

  -- A ping older than two days is not an earlier ping for this purpose: 90.
  delete from public.play_time where user_id = f;
  insert into public.play_time (user_id, day, seconds, last_ping) values (f, d - 5, 100, now() - interval '3 seconds');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f::text, true);
  got := public.add_play_time(60);
  if got <> 60 then raise exception 'FAIL: first ping with only an old row credited %, wanted 60', got; end if;
  reset role;

  delete from public.play_time where user_id = f;
  raise notice 'ok: add_play_time first ping of a day uses the real gap to the previous day''s last ping';
end $$;

-- probe_a: 600 + 300 + 50 + 70 + 1000 = 2020 s in all, and 950 s in the last 7 UTC days
-- (today, 3 and 6 days ago; the 7-day-old and 10-day-old rows are outside).
select pg_temp.expect('player_stats play time for probe_a (all time, last 7 days)',
  (select concat_ws(' ', seconds_played, seconds_week) from public.player_stats('probe_a')), '2020 950');
select pg_temp.expect('player_stats play time for a player who never played',
  (select concat_ws(' ', seconds_played, seconds_week) from public.player_stats('probe_c')), '0 0');
select pg_temp.expect('player_stats play time for probe_e (86400 s today)',
  (select concat_ws(' ', seconds_played, seconds_week) from public.player_stats('probe_e')), '86400 86400');
do $$
declare r text;
begin
  set local role anon;
  select seconds_played || ' ' || seconds_week into r from public.player_stats('probe_a');
  reset role;
  if r is distinct from '2020 950' then raise exception 'FAIL: a guest sees play time [%]', r; end if;
  raise notice 'ok: a guest reads play time through player_stats';
end $$;

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
