-- ONION//SKY leaderboard: the "Movers found" ranking.
-- Contract: docs/contracts/api.md section 7 (metric=movers). Additive and safe to re-run: nothing
-- earlier is changed; functions use `create or replace`, grants and revokes are idempotent.
--
-- A player's movers found = the number of DISTINCT real moving objects they correctly identified:
--   1. Stages: distinct (spot, find_key) over counted finds with verdict 'known'. A 'known' find is a
--      confirmed object (find_key 'object:<id>'), so a stage with several movers counts each one the
--      player marked, and solving a stage again counts nothing new. Not counted: 'nothing_correct'
--      (a "nothing moved" answer), wrong answers, 'candidate' / 'static', 'bot_match' (a bot
--      candidate that is no known object: unconfirmed, 0 points), practice repeats (counted = false)
--      and quick look.
--   2. Free-sky patches: one per patch_solves row that lists at least one known object in `objects`.
--      A patch answer is checked against ONE track, and `objects` lists every known object JPL puts
--      in the patch (per frame, positions only), not which one the player marked, so a solve is one
--      verified mover, never the length of that list. patch_solves has one row per player per patch.
--   A time window (p_since) applies to the solve time of each of these. Guests (user_id null) are
--   not ranked. There are no demo users in the tables; the bot row is added by the web server.
--
-- Ranking: movers, then points (sum of finds.points in the same window), then whoever reached that
-- count first (earlier last mover). Players with no mover are not on the board. A player with only
-- patch solves is ranked too (they have no finds, so their points are 0).
-- search_path is '' and every name is schema-qualified, like leaderboard_v2 (stricter than `public`).

create index if not exists patch_solves_user_idx on public.patch_solves (user_id, created_at) where user_id is not null;

-- Internal helper: the ranking rules in one place. Returns user ids, so nobody but the functions in
-- this file (which run as the owner) may call it.
create or replace function public.leaderboard_movers_ranked(p_slug text, p_since timestamptz, p_country text)
returns table (user_id uuid, country text, rank bigint, movers bigint, score bigint, accuracy numeric, finds bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with stage as (
    select d.user_id, count(*) as n, max(d.at) as last_at
    from (
      select f.user_id, f.spot_slug, f.find_key, min(f.created_at) as at
      from public.finds f
      where f.user_id is not null
        and f.counted
        and f.verdict = 'known'
        and f.find_key is not null
        and f.spot_slug <> 'quicklook'
        and (p_slug is null or f.spot_slug = p_slug)
        and (p_since is null or f.created_at >= p_since)
      group by f.user_id, f.spot_slug, f.find_key
    ) d
    group by d.user_id
  ),
  patch as (
    select s.user_id, count(*) as n, max(s.created_at) as last_at
    from public.patch_solves s
    where s.user_id is not null
      and p_slug is null
      and pg_catalog.jsonb_array_length(s.objects) > 0
      and (p_since is null or s.created_at >= p_since)
    group by s.user_id
  ),
  m as (
    select coalesce(st.user_id, pa.user_id) as user_id,
           coalesce(st.n, 0) + coalesce(pa.n, 0) as movers,
           greatest(st.last_at, pa.last_at) as last_at
    from stage st
    full join patch pa on pa.user_id = st.user_id
  ),
  j as (
    select m.user_id, pr.country, m.movers, m.last_at,
           coalesce(lr.score, 0)::bigint as score, lr.accuracy, coalesce(lr.finds, 0)::bigint as finds
    from m
    left join public.profiles pr on pr.id = m.user_id
    left join public.leaderboard_ranked(p_slug, p_since, null) lr on lr.user_id = m.user_id
    where m.movers > 0
      and (p_country is null or pr.country = pg_catalog.upper(p_country))
  )
  select j.user_id, j.country,
         rank() over (order by j.movers desc, j.score desc, j.last_at asc),
         j.movers::bigint, j.score, j.accuracy, j.finds
  from j;
$$;

-- Movers board: top p_limit rows (1 to 200, default 50) plus the caller's own row if further down.
-- `score` is the player's points. Call with the caller's token so is_me works.
create or replace function public.leaderboard_movers(
  p_slug text default null,
  p_since timestamptz default null,
  p_country text default null,
  p_limit int default 50
)
returns table (rank bigint, display_name text, movers bigint, score bigint, accuracy numeric, finds bigint, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rank, p.display_name, r.movers, r.score, round(r.accuracy, 3), r.finds,
         coalesce(r.user_id = (select auth.uid()), false)
  from public.leaderboard_movers_ranked(p_slug, p_since, p_country) r
  join public.profiles p on p.id = r.user_id
  where r.rank <= least(greatest(coalesce(p_limit, 50), 1), 200)
     or r.user_id = (select auth.uid())
  order by r.rank, p.display_name;
$$;

revoke execute on function
  public.leaderboard_movers_ranked(text, timestamptz, text),
  public.leaderboard_movers(text, timestamptz, text, int)
from public, anon, authenticated, service_role;

grant execute on function public.leaderboard_movers(text, timestamptz, text, int)
to anon, authenticated, service_role;
-- leaderboard_movers_ranked returns user ids: no grant to anyone but its owner.
