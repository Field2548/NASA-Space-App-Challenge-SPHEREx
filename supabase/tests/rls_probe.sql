-- Row-level security probes for supabase/migrations/20261115000000_init.sql (PLAN-3):
--   anon cannot insert into finds and cannot read emails; authenticated cannot write finds or
--   visits, cannot call record_find, and cannot read other users' rows.
--
-- Run as the `postgres` role after the migration: Supabase SQL editor, or
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_probe.sql
-- Each check is a DO block that raises an exception (and stops the script) on failure and
-- prints `ok: ...` on success. Everything runs in one transaction that is rolled back, so the
-- two probe users and their rows never persist.
-- Checked in PGlite (Postgres 16) with a Supabase-like auth schema on 2026-11-15.

begin;

-- ---------------------------------------------------------------- fixtures

-- Two users; the sign-up trigger makes their profiles. A third signs up with a reserved name:
-- the trigger must skip the profile, not fail the sign-up.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000a-0000-4000-8000-00000000000a', 'probe-a@example.invalid', '{"display_name": "probe_a"}'),
  ('0000000b-0000-4000-8000-00000000000b', 'probe-b@example.invalid', '{"display_name": "probe_b"}'),
  ('0000000c-0000-4000-8000-00000000000c', 'probe-c@example.invalid', '{"display_name": "Shift-and-stack BOT"}');

-- One correct find each, written the only allowed way (record_find, as the owner here).
select * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'probe-spot', 10, 10, 42,
  1, 2, 3, 4, 'known', 'Probe object', 'object:probe', 100, 50, false);
select * from public.record_find('0000000b-0000-4000-8000-00000000000b', 'probe-spot', 10, 10, 42,
  1, 2, 3, 4, 'known', 'Probe object', 'object:probe', 100, 50, false);
insert into public.spot_requests (user_id, ra, dec, fov) values
  ('0000000b-0000-4000-8000-00000000000b', 10, 10, 0.2);

do $$
begin
  if (select count(*) from public.profiles where display_name in ('probe_a', 'probe_b')) <> 2 then
    raise exception 'FAIL: fixture: the sign-up trigger did not create both profiles';
  end if;
  if exists (select 1 from public.profiles where id = '0000000c-0000-4000-8000-00000000000c') then
    raise exception 'FAIL: the sign-up trigger saved a reserved display name';
  end if;
  raise notice 'ok: fixtures (3 users, 2 profiles, 2 finds; the reserved name was skipped)';
end $$;

-- ---------------------------------------------------------------- anon

do $$
begin
  set local role anon;
  begin
    insert into public.finds (spot_slug, ra, dec, hpx12, verdict, points) values ('probe', 0, 0, 0, 'known', 9999);
    raise exception 'FAIL: anon inserted a row into finds';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: anon cannot insert into finds';
end $$;

do $$
begin
  set local role anon;
  begin
    perform email from auth.users limit 1;
    raise exception 'FAIL: anon read auth.users (emails)';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: anon cannot read emails in auth.users';
end $$;

do $$
declare
  t text;
begin
  set local role anon;
  foreach t in array array['public.finds', 'public.visits', 'public.profiles', 'public.spot_requests'] loop
    begin
      execute format('select count(*) from %s', t);
      raise exception 'FAIL: anon can read table %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  reset role;
  raise notice 'ok: anon cannot read finds, visits, profiles or spot_requests directly';
end $$;

do $$
begin
  set local role anon;
  begin
    perform * from public.record_find(null, 'probe', 0, 0, 0, null, null, null, null,
      'known', 'x', 'object:x', 1000, 0, false);
    raise exception 'FAIL: anon called record_find';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nextval('public.finds_id_seq');
    raise exception 'FAIL: anon can use the finds id sequence';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: anon cannot call record_find or use the sequences';
end $$;

do $$
declare
  r jsonb;
begin
  set local role anon;
  for r in select to_jsonb(l) from public.leaderboard() l loop
    if (select array_agg(k order by k) from jsonb_object_keys(r) k)
       <> array['accuracy', 'display_name', 'is_me', 'rank', 'score'] then
      raise exception 'FAIL: leaderboard returns other columns: %', r;
    end if;
    if r::text like '%@%' then
      raise exception 'FAIL: leaderboard row contains an email: %', r;
    end if;
  end loop;
  reset role;
  raise notice 'ok: leaderboard() gives names and numbers only (no user ids, no emails)';
end $$;

-- ---------------------------------------------------------------- authenticated (user A)

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000a-0000-4000-8000-00000000000a', true);
  perform set_config('request.jwt.claims', '{"sub": "0000000a-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

  begin
    insert into public.finds (user_id, spot_slug, ra, dec, hpx12, verdict, points)
    values ('0000000a-0000-4000-8000-00000000000a', 'probe', 0, 0, 0, 'known', 9999);
    raise exception 'FAIL: authenticated inserted into finds';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.finds set points = 99999;
    raise exception 'FAIL: authenticated updated finds';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.finds;
    raise exception 'FAIL: authenticated deleted from finds';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.visits (user_id, spot_slug, hpx12) values ('0000000a-0000-4000-8000-00000000000a', 'eris', 1);
    raise exception 'FAIL: authenticated inserted into visits';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.record_find('0000000a-0000-4000-8000-00000000000a', 'probe', 0, 0, 0, null, null, null, null,
      'known', 'x', 'object:x', 1000, 0, false);
    raise exception 'FAIL: authenticated called record_find';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nextval('public.finds_id_seq');
    raise exception 'FAIL: authenticated can use the finds id sequence';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: authenticated cannot write finds or visits, call record_find, or use the sequences';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000a-0000-4000-8000-00000000000a', true);
  perform set_config('request.jwt.claims', '{"sub": "0000000a-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

  if (select count(*) from public.finds where user_id = '0000000b-0000-4000-8000-00000000000b') <> 0 then
    raise exception 'FAIL: user A can read user B''s finds';
  end if;
  if (select count(*) from public.finds) <> 1 then
    raise exception 'FAIL: user A does not see exactly their own find';
  end if;
  if (select count(*) from public.visits where user_id <> '0000000a-0000-4000-8000-00000000000a') <> 0 then
    raise exception 'FAIL: user A can read other users'' visits';
  end if;
  if exists (select 1 from public.profiles where id <> '0000000a-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: user A can read other users'' profiles';
  end if;
  if exists (select 1 from public.spot_requests where user_id is distinct from '0000000a-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: user A can read other users'' spot requests';
  end if;
  begin
    perform email from auth.users limit 1;
    raise exception 'FAIL: authenticated read auth.users (emails)';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: authenticated sees only their own rows and no emails';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '0000000a-0000-4000-8000-00000000000a', true);
  perform set_config('request.jwt.claims', '{"sub": "0000000a-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

  -- The name is chosen once at sign-up: no update of display_name, valid or not (migration display_name_once).
  begin
    update public.profiles set display_name = 'probe_a_renamed';
    raise exception 'FAIL: a player renamed themselves';
  exception when insufficient_privilege then null;
  end;
  if (select display_name from public.profiles where id = '0000000a-0000-4000-8000-00000000000a') <> 'probe_a' then
    raise exception 'FAIL: user A cannot read their own display name';
  end if;
  begin
    update public.profiles set id = '0000000b-0000-4000-8000-00000000000b';
    raise exception 'FAIL: a player changed their profile id';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, display_name) values ('0000000c-0000-4000-8000-00000000000c', 'imposter');
    raise exception 'FAIL: a player created a profile for someone else';
  exception when insufficient_privilege then null;   -- the row-level security policy
  end;
  if public.display_name_available('BOT') or public.display_name_available('ab')
     or public.display_name_available('PROBE_A') then
    raise exception 'FAIL: display_name_available accepts a reserved, short or taken name';
  end if;
  reset role;
  raise notice 'ok: a player can read but never change their display name';
end $$;

-- ---------------------------------------------------------------- repeats, row cap, request queue

do $$
declare
  a constant uuid := '0000000a-0000-4000-8000-00000000000a';
  r record;
  n int;
begin
  -- Two candidates on one spot by one player: the second is a repeat, not counted.
  perform * from public.record_find(a, 'repeat-spot', 10, 10, 42, 1, 2, 3, 4, 'candidate', null, null, 0, 0, false);
  select * into r from public.record_find(a, 'repeat-spot', 10, 10, 42, 1, 2, 3, 4, 'candidate', null, null, 0, 0, false);
  if r.counted or not r.already_found then
    raise exception 'FAIL: a repeated candidate was counted';
  end if;
  select count(*) into n from public.finds where user_id = a and spot_slug = 'repeat-spot' and counted;
  if n <> 1 then raise exception 'FAIL: expected 1 counted candidate row, found %', n; end if;

  -- The 51st row from one player on one spot is not inserted.
  for i in 1..60 loop
    perform * from public.record_find(a, 'cap-spot', 10, 10, 42, null, null, null, null, 'nothing_wrong', null, null, 0, 0, false);
  end loop;
  select count(*) into n from public.finds where user_id = a and spot_slug = 'cap-spot';
  if n <> 50 then raise exception 'FAIL: expected 50 rows after the cap, found %', n; end if;
  select * into r from public.record_find(a, 'cap-spot', 10, 10, 42, null, null, null, null, 'nothing_wrong', null, null, 0, 0, false);
  if not r.already_found or r.points <> 0 then raise exception 'FAIL: the capped call did not report already_found'; end if;
  raise notice 'ok: repeated candidates are not counted and a player has at most 50 rows per spot';
end $$;

do $$
declare
  r record;
  n int;
begin
  select * into r from public.request_spot(null, 200, -30, 0.2);
  if r.duplicate then raise exception 'FAIL: a first request was called a duplicate'; end if;
  select * into r from public.request_spot(null, 200.03, -30.02, 0.2);
  if not r.duplicate then raise exception 'FAIL: a request 0.04 degrees away was not a duplicate'; end if;
  select * into r from public.request_spot(null, 200.2, -30, 0.2);
  if r.duplicate then raise exception 'FAIL: a request 0.2 degrees away was a duplicate'; end if;

  insert into public.spot_requests (ra, dec)
    select 100 + (g % 100), -60 + g * 0.3 from generate_series(1, 210) g;
  begin
    perform * from public.request_spot(null, 300, 40, 0.2);
    raise exception 'FAIL: request_spot accepted a request with a full queue';
  exception when others then
    if sqlerrm <> 'queue_full' then raise; end if;
  end;

  set local role authenticated;
  begin
    perform * from public.request_spot(null, 1, 1, 0.2);
    raise exception 'FAIL: authenticated called request_spot';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: request_spot de-duplicates, refuses a full queue and is service-role only';
end $$;

rollback;
