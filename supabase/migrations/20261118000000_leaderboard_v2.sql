-- ONION//SKY leaderboard v2: weekly window, local (per country) boards, per-player stats.
-- Contract: docs/contracts/api.md sections 7 and 7a. Probe: supabase/tests/leaderboard_v2_probe.sql.
--
-- Additive and safe to re-run: nothing from the earlier migrations is changed or dropped
-- (the old leaderboard() keeps working for callers that have not moved on), columns and indexes use
-- `if not exists`, functions use `create or replace`, grants and revokes are idempotent.
--
-- What is added:
--   profiles.country          two-letter country code of a player (null = unknown). Only the code is
--                             stored, never an IP address. Players cannot write it directly (the
--                             column grant on profiles is unchanged); they call set_my_country().
--   set_my_country(code)      sets the CALLER's own country. A guest, or a value that is not two
--                             letters, changes nothing. authenticated only.
--   leaderboard_ranked(...)   internal helper (not callable by anon or authenticated): the one place
--                             that decides who is ranked and how. It returns user ids, so nobody
--                             but the other functions in this file may call it.
--   leaderboard_v2(...)       like leaderboard() plus a time window (p_since), a country filter and a
--                             `finds` count. Top p_limit rows plus the caller's own row.
--   leaderboard_countries()   countries that have ranked players in a window, with player counts.
--   player_stats(name)        one player's public numbers by display name. Never returns a user id,
--                             and never which stages the player solved. Dates are day-level (UTC).
--   player_spots(name)        the spot slugs a player solved. service_role ONLY (the web server turns
--                             them into per-difficulty counts; the slugs never reach a browser).
--   play_time                 seconds a logged-in player has spent playing, one row per player and UTC
--                             day. RLS on, no policies, no grants: only the functions below touch it.
--   add_play_time(seconds)    the caller reports play time; the credit is capped by the real time since
--                             their last report, so a forged client cannot add more than elapsed time.
--                             authenticated only.
--   player_stats also returns seconds_played (all time) and seconds_week (the last 7 UTC days).
-- The index on finds(created_at) below is created without `concurrently` (the table is small at
-- the moment, so the brief write lock is fine; use a separate concurrent build if it ever grows).
-- Everything public is stable, security definer, search_path = '' and returns names and numbers only.

-- ---------------------------------------------------------------- country on profiles

alter table public.profiles
  add column if not exists country text
    constraint profiles_country_valid check (country ~ '^[A-Z]{2}$');

-- Local boards filter on country; the weekly window filters finds on time.
create index if not exists profiles_country_idx on public.profiles (country) where country is not null;
create index if not exists finds_created_idx on public.finds (created_at);

-- A player may only change their own country, and only to a plain two-letter code. profiles has no
-- column grant for country on purpose (a direct write could set any two letters on any request),
-- so the write goes through this function, which touches only the caller's row. "XX" is what some
-- networks send for "unknown", so it is refused too.
create or replace function public.set_my_country(p_country text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p
  set country = pg_catalog.upper(pg_catalog.btrim(p_country))
  where p.id = (select auth.uid())
    and pg_catalog.btrim(p_country) ~ '^[A-Za-z]{2}$'
    and pg_catalog.upper(pg_catalog.btrim(p_country)) <> 'XX'
    and p.country is distinct from pg_catalog.upper(pg_catalog.btrim(p_country));
$$;

-- ---------------------------------------------------------------- play time

-- Seconds played, per player and UTC day. Written only by add_play_time() (security definer), read
-- only by player_stats(). The check keeps a day within 24 hours.
create table if not exists public.play_time (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  seconds int not null default 0 check (seconds between 0 and 86400),
  last_ping timestamptz,
  primary key (user_id, day)
);
comment on table public.play_time is
  'Seconds a logged-in player spent playing a stage, per UTC day. Written by add_play_time() only.';
alter table public.play_time enable row level security;
-- No policies: nobody reads or writes this table directly.
revoke all on public.play_time from anon, authenticated;

-- The caller reports p_seconds of play. The credit is the smallest of: p_seconds (never below 0),
-- 90, the seconds since this player's last report (the first report of a UTC day measures from the
-- player's last report on the previous two days, and counts as 90 only when there is no earlier
-- report at all), and what is left of the day (86400). So a forged client can add at most the real time that has passed,
-- and a day never exceeds 24 hours. Returns the seconds credited (0 for a guest). The row is locked
-- while it is updated, so two parallel calls cannot both claim the same gap. The gap is measured with
-- clock_timestamp() taken after the lock is acquired, and last_ping never moves backwards.
create or replace function public.add_play_time(p_seconds int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_have int;
  v_last timestamptz;
  v_now timestamptz;
  v_prev timestamptz;
  v_gap int;
  v_credit int;
begin
  if v_uid is null then
    return 0;
  end if;

  insert into public.play_time (user_id, day) values (v_uid, v_day)
  on conflict (user_id, day) do nothing;

  select t.seconds, t.last_ping into v_have, v_last
  from public.play_time t
  where t.user_id = v_uid and t.day = v_day
  for update;

  -- Taken after the row lock, so a call that waited for the lock measures from its own real time.
  v_now := pg_catalog.clock_timestamp();

  -- No ping yet today: measure from the latest ping on the previous two days, if there is one.
  if v_last is null then
    select pg_catalog.max(t.last_ping) into v_prev
    from public.play_time t
    where t.user_id = v_uid and t.day >= v_day - 2 and t.day < v_day;
  end if;

  v_gap := case
    when coalesce(v_last, v_prev) is null then 90
    else greatest(0, pg_catalog.floor(pg_catalog.date_part('epoch', v_now - coalesce(v_last, v_prev)))::int)
  end;
  v_credit := least(greatest(coalesce(p_seconds, 0), 0), 90, v_gap, 86400 - v_have);

  update public.play_time t
  set seconds = t.seconds + v_credit, last_ping = greatest(coalesce(v_last, v_now), v_now)
  where t.user_id = v_uid and t.day = v_day;

  return v_credit;
end;
$$;

-- ---------------------------------------------------------------- internal ranking helper

-- The ranking rules, written once so the boards, the country list and player_stats cannot drift apart.
--   p_slug     null = every stage, else one spot.
--   p_since    null = all time, else only finds created at or after this moment.
--   p_country  null = everyone, else only players whose profile country equals upper(p_country).
-- Same rules as leaderboard(): score = sum of points; accuracy = correct counted submissions /
-- counted submissions (null with none); rank by score then accuracy (nulls last), ties share a rank.
-- `finds` = counted submissions in the window. A player with no profile is still ranked (as in
-- leaderboard()); the public functions below drop them because they have no name to show.
create or replace function public.leaderboard_ranked(p_slug text, p_since timestamptz, p_country text)
returns table (user_id uuid, country text, rank bigint, score bigint, accuracy numeric, finds bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select f.user_id,
           pr.country,
           sum(f.points)::bigint as score,
           (count(*) filter (where f.counted and f.verdict in ('known', 'bot_match', 'nothing_correct')))::numeric
             / nullif(count(*) filter (where f.counted), 0) as accuracy,
           (count(*) filter (where f.counted))::bigint as finds
    from public.finds f
    left join public.profiles pr on pr.id = f.user_id
    where f.user_id is not null
      and (p_slug is null or f.spot_slug = p_slug)
      and (p_since is null or f.created_at >= p_since)
      and (p_country is null or pr.country = pg_catalog.upper(p_country))
    group by f.user_id, pr.country
  )
  select s.user_id, s.country,
         rank() over (order by s.score desc, s.accuracy desc nulls last),
         s.score, s.accuracy, s.finds
  from s;
$$;

-- ---------------------------------------------------------------- public reads

-- Scoreboard with a window and a country filter. Returns the top p_limit rows (1 to 200, default 50)
-- plus the caller's own row if they are further down. Call with the caller's token so is_me works.
create or replace function public.leaderboard_v2(
  p_slug text default null,
  p_since timestamptz default null,
  p_country text default null,
  p_limit int default 50
)
returns table (rank bigint, display_name text, score bigint, accuracy numeric, finds bigint, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rank, p.display_name, r.score, round(r.accuracy, 3), r.finds,
         coalesce(r.user_id = (select auth.uid()), false)
  from public.leaderboard_ranked(p_slug, p_since, p_country) r
  join public.profiles p on p.id = r.user_id
  where r.rank <= least(greatest(coalesce(p_limit, 50), 1), 200)
     or r.user_id = (select auth.uid())
  order by r.rank, p.display_name;
$$;

-- Every country with at least one ranked player in the window (and stage, if given), most players first.
-- Players without a country are not listed.
create or replace function public.leaderboard_countries(p_slug text default null, p_since timestamptz default null)
returns table (code text, players bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.country, count(*)::bigint
  from public.leaderboard_ranked(p_slug, p_since, null) r
  join public.profiles p on p.id = r.user_id
  where r.country is not null
  group by r.country
  order by 2 desc, 1;
$$;

-- One player's public numbers, found by exact display name (case-insensitive; names are unique).
-- Zero rows for an unknown name. Which stages were solved is NOT here: the anon key is public, so
-- anyone could call this function directly. See player_spots() (service_role only).
--   member_since / last_active  truncated to the UTC day (no exact activity times are public).
--   points / points_week     sum of points, all time / last 7 days.
--   rank_all / rank_week     rank on the global all-stages board for those periods, exactly as
--                            leaderboard_v2() gives it whenever the player is on that board (any find
--                            in the period, even a zero-point one); null only with no find in the period.
--   classifications, correct counted submissions on spots (quick look excluded) and how many were correct.
--   first_finds              rows where this player was the first finder.
--   patches_solved           rows in patch_solves.
--   active_days              distinct UTC dates with any find or patch solve.
--   seconds_played           all-time seconds of play (sum of play_time).
--   seconds_week             seconds of play on the last 7 UTC days (today and the 6 before it).
-- No user id is returned. Call with the caller's token so is_me works.
-- An earlier draft of this function also returned spots_solved; a changed result type cannot be
-- replaced in place, so drop it first (the grants below are re-applied on every run).
drop function if exists public.player_stats(text);
create or replace function public.player_stats(p_name text)
returns table (
  display_name text, is_me boolean, country text, member_since timestamptz, last_active timestamptz,
  points bigint, points_week bigint, rank_all bigint, rank_week bigint,
  classifications bigint, correct bigint, first_finds bigint, patches_solved bigint, active_days bigint,
  seconds_played bigint, seconds_week bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name,
         coalesce(p.id = (select auth.uid()), false),
         p.country,
         pg_catalog.date_trunc('day', p.created_at at time zone 'UTC') at time zone 'UTC',
         pg_catalog.date_trunc('day', greatest(
           (select max(f.created_at) from public.finds f where f.user_id = p.id),
           (select max(s.created_at) from public.patch_solves s where s.user_id = p.id)) at time zone 'UTC') at time zone 'UTC',
         (select coalesce(sum(f.points), 0)::bigint from public.finds f where f.user_id = p.id),
         (select coalesce(sum(f.points), 0)::bigint from public.finds f
            where f.user_id = p.id and f.created_at >= now() - interval '7 days'),
         (select r.rank from public.leaderboard_ranked(null, null, null) r where r.user_id = p.id),
         (select r.rank from public.leaderboard_ranked(null, now() - interval '7 days', null) r
            where r.user_id = p.id),
         (select count(*) from public.finds f
            where f.user_id = p.id and f.counted and f.spot_slug <> 'quicklook'),
         (select count(*) from public.finds f
            where f.user_id = p.id and f.counted and f.spot_slug <> 'quicklook'
              and f.verdict in ('known', 'bot_match', 'nothing_correct')),
         (select count(*) from public.finds f where f.user_id = p.id and f.first_finder),
         (select count(*) from public.patch_solves s where s.user_id = p.id),
         (select count(distinct d.day)
            from (select (f.created_at at time zone 'UTC')::date as day from public.finds f where f.user_id = p.id
                  union
                  select (s.created_at at time zone 'UTC')::date from public.patch_solves s where s.user_id = p.id) d),
         (select coalesce(sum(t.seconds), 0)::bigint from public.play_time t where t.user_id = p.id),
         (select coalesce(sum(t.seconds), 0)::bigint from public.play_time t
            where t.user_id = p.id and t.day > (pg_catalog.now() at time zone 'UTC')::date - 7)
  from public.profiles p
  where pg_catalog.lower(p.display_name) = pg_catalog.lower(pg_catalog.btrim(p_name))
  limit 1;
$$;

-- The spot slugs (never 'quicklook') a player has a counted correct answer on, by exact display
-- name (case-insensitive). Empty for an unknown name or a player with none. Kept out of
-- player_stats on purpose: this one is callable by service_role only, so only the web server sees
-- the slugs and publishes counts per difficulty.
create or replace function public.player_spots(p_name text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct f.spot_slug order by f.spot_slug), '{}'::text[])
  from public.profiles p
  join public.finds f on f.user_id = p.id
  where pg_catalog.lower(p.display_name) = pg_catalog.lower(pg_catalog.btrim(p_name))
    and f.counted and f.spot_slug <> 'quicklook'
    and f.verdict in ('known', 'bot_match', 'nothing_correct');
$$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function
  public.set_my_country(text),
  public.leaderboard_ranked(text, timestamptz, text),
  public.leaderboard_v2(text, timestamptz, text, int),
  public.leaderboard_countries(text, timestamptz),
  public.player_stats(text),
  public.player_spots(text),
  public.add_play_time(int)
from public, anon, authenticated, service_role;

-- A guest has no profile to change, so set_my_country is for logged-in players only.
grant execute on function public.set_my_country(text) to authenticated;

-- Likewise play time: a guest has nothing to credit. Callers pass only the number of seconds; the
-- function decides how much of it counts.
grant execute on function public.add_play_time(int) to authenticated;

grant execute on function
  public.leaderboard_v2(text, timestamptz, text, int),
  public.leaderboard_countries(text, timestamptz),
  public.player_stats(text)
to anon, authenticated, service_role;

-- leaderboard_ranked returns user ids: no grant to anyone but its owner (the other functions here
-- run as the owner, so they can still call it).

-- player_spots lists solved stages by name: service_role only (the web server's own client).
grant execute on function public.player_spots(text) to service_role;
