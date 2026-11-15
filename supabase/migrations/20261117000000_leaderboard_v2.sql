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
-- No user id is returned. Call with the caller's token so is_me works.
-- An earlier draft of this function also returned spots_solved; a changed result type cannot be
-- replaced in place, so drop it first (the grants below are re-applied on every run).
drop function if exists public.player_stats(text);
create or replace function public.player_stats(p_name text)
returns table (
  display_name text, is_me boolean, country text, member_since timestamptz, last_active timestamptz,
  points bigint, points_week bigint, rank_all bigint, rank_week bigint,
  classifications bigint, correct bigint, first_finds bigint, patches_solved bigint, active_days bigint
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
                  select (s.created_at at time zone 'UTC')::date from public.patch_solves s where s.user_id = p.id) d)
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
  public.player_spots(text)
from public, anon, authenticated, service_role;

-- A guest has no profile to change, so set_my_country is for logged-in players only.
grant execute on function public.set_my_country(text) to authenticated;

grant execute on function
  public.leaderboard_v2(text, timestamptz, text, int),
  public.leaderboard_countries(text, timestamptz),
  public.player_stats(text)
to anon, authenticated, service_role;

-- leaderboard_ranked returns user ids: no grant to anyone but its owner (the other functions here
-- run as the owner, so they can still call it).

-- player_spots lists solved stages by name: service_role only (the web server's own client).
grant execute on function public.player_spots(text) to service_role;
