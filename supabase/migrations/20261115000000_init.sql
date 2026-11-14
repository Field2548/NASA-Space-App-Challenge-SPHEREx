-- ONION//SKY: accounts, finds, checked spots and the request queue.
-- Tables follow docs/BUILD_PROMPT.md section 10; behaviour follows docs/contracts/api.md 1.2.
-- Rules that shape everything below:
--   * Row-level security is on for every table.
--   * Only the server (service role, inside /api/check) writes finds and visits,
--     so nobody can give themselves points.
--   * Public reads (scoreboard, density, request queue) go through functions that
--     return counts and display names only: no emails, no user ids.
--   * leaderboard() and density() use auth.uid(): call them with the caller's token
--     (anon key + Authorization header), never with the service role.
-- Probes for the row-level security: supabase/tests/rls_probe.sql.

-- ---------------------------------------------------------------- display names

-- 3 to 20 characters from A-Z a-z 0-9 space _ . -, no spaces at either end, and not a name
-- that could pass for the scoreboard's bot row. One rule for the table, the sign-up trigger
-- and display_name_available().
create function public.display_name_valid(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_name = pg_catalog.btrim(p_name)
    and p_name ~ '^[A-Za-z0-9 _.-]{3,20}$'
    and pg_catalog.lower(p_name) not in ('shift-and-stack bot', 'bot'),
    false);
$$;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text unique not null
    constraint profiles_display_name_valid check (public.display_name_valid(display_name)),
  created_at timestamptz not null default now()
);
-- "Nova" and "nova" are the same name on a scoreboard.
create unique index profiles_display_name_lower_idx on public.profiles (lower(display_name));

create table public.finds (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,   -- null: a guest's quick-look candidate
  spot_slug text not null,                                 -- 'quicklook' for quick-look marks
  ra double precision not null,
  dec double precision not null,
  hpx12 bigint not null,                                   -- HEALPix NESTED, order 12
  x real, y real, vx_px_day real, vy_px_day real,
  verdict text not null check (verdict in
    ('known', 'bot_match', 'candidate', 'static', 'nothing_correct', 'nothing_wrong')),
  object_name text,
  -- What "the same find" is in a spot: 'object:<id>', 'bot:<rank>' or 'nothing' (from the
  -- scorer); null for wrong answers.
  find_key text,
  points int not null default 0 check (points >= 0),
  first_finder boolean not null default false,
  -- false for a repeat of the same find_key by the same user, a practice submission on a spot
  -- that was already open, and every quick-look row. Accuracy and the Finds layer count only
  -- counted rows.
  counted boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.finds is
  'One row per /api/check submission. For a ready spot, ra/dec/hpx12 are the SPOT CENTRE, never '
  'the mover''s position, so the Finds density layer cannot point at an answer. For quick look '
  '(spot_slug = ''quicklook'') they are the marked position. Written only by record_find().';

create table public.visits (                               -- the "Checked" layer
  user_id uuid not null references auth.users on delete cascade,
  spot_slug text not null,
  hpx12 bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_slug)
);
comment on table public.visits is
  'One row per player per ready spot, saved with their first correct submission there (the moment the spot unlocks).';

create table public.spot_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  ra double precision not null check (ra >= 0 and ra < 360),
  dec double precision not null check (dec between -90 and 90),
  fov real not null default 0.2 check (fov between 0.05 and 0.5),
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes

create index finds_hpx12_idx on public.finds (hpx12);
-- "Already found" lookups; also covers the user_id foreign key.
create index finds_user_spot_key_idx on public.finds (user_id, spot_slug, find_key);
create index finds_spot_idx on public.finds (spot_slug);
-- At most one first finder per object in a spot, even if two players submit at once.
create unique index finds_first_finder_idx on public.finds (spot_slug, find_key) where first_finder;
create index visits_hpx12_idx on public.visits (hpx12);
create index spot_requests_user_idx on public.spot_requests (user_id);
create index spot_requests_created_idx on public.spot_requests (created_at desc);

-- ---------------------------------------------------------------- row-level security

alter table public.profiles enable row level security;
alter table public.finds enable row level security;
alter table public.visits enable row level security;
alter table public.spot_requests enable row level security;

-- Start from nothing, then grant the minimum. The service role bypasses RLS.
revoke all on public.profiles, public.finds, public.visits, public.spot_requests from anon, authenticated;
-- Supabase's default privileges also grant the identity sequences; nobody but the server needs them.
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.profiles, public.finds, public.visits, public.spot_requests to authenticated;
grant insert (id, display_name), update (display_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Read your own rows. No insert, update or delete policy exists on purpose.
create policy finds_select_own on public.finds
  for select to authenticated using (user_id = (select auth.uid()));
create policy visits_select_own on public.visits
  for select to authenticated using (user_id = (select auth.uid()));
create policy spot_requests_select_own on public.spot_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- profile on signup

-- The sign-up form sends the display name as user metadata. Creating the profile here
-- works even when email confirmation is on (no session yet in the browser).
-- A name that breaks the rule (display_name_valid) is skipped: the account is created without
-- a profile and the app asks for a name later. A taken name fails the sign-up; the form checks
-- display_name_available() first.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name');
begin
  if public.display_name_valid(v_name) then
    insert into public.profiles (id, display_name) values (new.id, v_name);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- False for a taken name and for a name that breaks the rule (including the reserved ones).
create function public.display_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.display_name_valid(pg_catalog.btrim(p_name))
     and not exists (
       select 1 from public.profiles p where lower(p.display_name) = lower(pg_catalog.btrim(p_name))
     );
$$;

-- ---------------------------------------------------------------- public reads

-- Scoreboard. p_slug null = all time. Returns the top p_limit rows, plus the caller's
-- own row if they are further down. Accuracy = correct counted submissions / counted
-- submissions (null with none). Call with the caller's token so is_me works.
create function public.leaderboard(p_slug text default null, p_limit int default 50)
returns table (rank bigint, display_name text, score bigint, accuracy numeric, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select f.user_id,
           sum(f.points)::bigint as score,
           (count(*) filter (where f.counted and f.verdict in ('known', 'bot_match', 'nothing_correct')))::numeric
             / nullif(count(*) filter (where f.counted), 0) as accuracy
    from public.finds f
    where f.user_id is not null
      and (p_slug is null or f.spot_slug = p_slug)
    group by f.user_id
  ),
  r as (
    select rank() over (order by s.score desc, s.accuracy desc nulls last) as rank, s.user_id, s.score, s.accuracy
    from s
  )
  select r.rank, p.display_name, r.score, round(r.accuracy, 3),
         coalesce(r.user_id = (select auth.uid()), false)
  from r
  join public.profiles p on p.id = r.user_id
  where r.rank <= least(greatest(coalesce(p_limit, 50), 1), 200)
     or r.user_id = (select auth.uid())
  order by r.rank, p.display_name;
$$;

-- Density layers on the HEALPix tree. In NESTED order a parent cell is the child index
-- shifted right by 2 bits per level, so the stored order 12 serves every zoom level.
-- p_layer: 'finds' (counted known / bot_match / candidate rows) or 'checked' (one per player per spot).
-- p_who: 'all', 'me' (the caller's rows) or 'others' (all minus the caller's). 'me' and
-- 'others' need a logged-in caller and return nothing for guests. Call with the caller's token.
create function public.density(p_layer text, p_order int default 4, p_who text default 'all')
returns table (ipix bigint, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid)
  select f.hpx12 >> (2 * (12 - p_order)), count(*)
  from public.finds f, me
  where p_layer = 'finds'
    and p_order between 0 and 12
    and f.counted
    and f.verdict in ('known', 'bot_match', 'candidate')
    and (p_who = 'all'
         or (p_who = 'me' and me.uid is not null and f.user_id = me.uid)
         or (p_who = 'others' and me.uid is not null and f.user_id is distinct from me.uid))
  group by 1
  union all
  select v.hpx12 >> (2 * (12 - p_order)), count(*)
  from public.visits v, me
  where p_layer = 'checked'
    and p_order between 0 and 12
    and (p_who = 'all'
         or (p_who = 'me' and me.uid is not null and v.user_id = me.uid)
         or (p_who = 'others' and me.uid is not null and v.user_id is distinct from me.uid))
  group by 1;
$$;

-- The 1.1 form, kept so callers that send p_mine keep working: p_mine true = 'me', else 'all'.
-- No defaults on purpose, so a call without p_mine always picks the function above.
create function public.density(p_layer text, p_order int, p_mine boolean)
returns table (ipix bigint, n bigint)
language sql
stable
set search_path = ''
as $$
  select d.ipix, d.n
  from public.density(p_layer, p_order, case when p_mine then 'me' else 'all' end) d;
$$;

-- The request queue for /requests: positions and status only.
create function public.spot_request_queue(p_limit int default 100)
returns table (id bigint, ra double precision, "dec" double precision, fov real, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.ra, q.dec, q.fov, q.status, q.created_at
  from public.spot_requests q
  order by q.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

-- Tiny query for the daily keep-alive cron.
create function public.ping()
returns int
language sql
stable
set search_path = ''
as $$ select 1; $$;

-- ---------------------------------------------------------------- server-only write

-- Called by /api/check with the service role. Decides "first finder" and "already found"
-- in one transaction, saves the find and, for a correct answer, marks the spot as checked.
--   p_find_key  the scorer's find key ('object:<id>', 'bot:<rank>', 'nothing'); null for wrong answers.
--   p_points    the base score computed by the server; p_bonus is added only for a first finder
--               of a 'known' object.
--   p_practice  the spot was already open for this player (unlock cookie): 0 points, never a
--               first finder, not counted.
--   p_ra, p_dec, p_hpx12: the SPOT CENTRE for a ready spot, the marked position for quick look.
-- A quick-look row (p_spot = 'quicklook') scores nothing, is never a first finder and is not counted.
create function public.record_find(
  p_user uuid, p_spot text, p_ra double precision, p_dec double precision, p_hpx12 bigint,
  p_x real, p_y real, p_vx real, p_vy real,
  p_verdict text, p_object_name text, p_find_key text, p_points int, p_bonus int,
  p_practice boolean default false
)
returns table (first_finder boolean, already_found boolean, points int, counted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct boolean := p_verdict in ('known', 'bot_match', 'nothing_correct');
  v_quick boolean := p_spot = 'quicklook';
  v_practice boolean := coalesce(p_practice, false);
  v_key text := coalesce(p_find_key, p_verdict);   -- what "the same find" means in a spot
  v_first boolean := false;
  v_already boolean := false;
  v_counted boolean;
  v_points int := 0;
begin
  -- One submission at a time per find in a spot (first finder and already-found are decided here).
  perform pg_advisory_xact_lock(hashtextextended(p_spot || '/' || v_key, 0));

  -- Already found = this user has an earlier COUNTED correct row with the same key (practice and
  -- quick-look rows never block a real find, and a find is counted at most once).
  if v_correct and p_user is not null then
    select exists (
      select 1 from public.finds f
      where f.user_id = p_user and f.spot_slug = p_spot and f.counted
        and f.verdict in ('known', 'bot_match', 'nothing_correct')
        and coalesce(f.find_key, f.verdict) = v_key
    ) into v_already;
  end if;

  v_counted := not v_quick and not v_practice and not v_already;

  if v_correct and p_user is not null and v_counted then
    v_points := greatest(coalesce(p_points, 0), 0);
    if p_verdict = 'known' and p_find_key is not null then
      select not exists (
        select 1 from public.finds f
        where f.spot_slug = p_spot and f.find_key = p_find_key and f.first_finder
      ) into v_first;
      if v_first then
        v_points := v_points + greatest(coalesce(p_bonus, 0), 0);
      end if;
    end if;
  end if;

  insert into public.finds
    (user_id, spot_slug, ra, dec, hpx12, x, y, vx_px_day, vy_px_day, verdict, object_name,
     find_key, points, first_finder, counted)
  values
    (p_user, p_spot, p_ra, p_dec, p_hpx12, p_x, p_y, p_vx, p_vy, p_verdict, p_object_name,
     p_find_key, v_points, v_first, v_counted);

  if p_user is not null and v_correct and not v_quick then
    insert into public.visits (user_id, spot_slug, hpx12)
    values (p_user, p_spot, p_hpx12)
    on conflict (user_id, spot_slug) do nothing;
  end if;

  return query select v_first, v_already, v_points, v_counted;
end;
$$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function
  public.display_name_valid(text),
  public.handle_new_user(),
  public.display_name_available(text),
  public.leaderboard(text, int),
  public.density(text, int, text),
  public.density(text, int, boolean),
  public.spot_request_queue(int),
  public.ping(),
  public.record_find(uuid, text, double precision, double precision, bigint, real, real, real, real, text, text, text, int, int, boolean)
from public, anon, authenticated;

-- display_name_valid is pure and is evaluated by the profiles check constraint.
grant execute on function
  public.display_name_valid(text),
  public.display_name_available(text),
  public.leaderboard(text, int),
  public.density(text, int, text),
  public.density(text, int, boolean),
  public.spot_request_queue(int),
  public.ping()
to anon, authenticated, service_role;

grant execute on function
  public.record_find(uuid, text, double precision, double precision, bigint, real, real, real, real, text, text, text, int, int, boolean)
to service_role;
