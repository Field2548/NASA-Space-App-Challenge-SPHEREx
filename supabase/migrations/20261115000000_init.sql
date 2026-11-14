-- ONION//SKY: accounts, finds, checked spots and the request queue.
-- Tables follow docs/BUILD_PROMPT.md section 10. Rules that shape everything below:
--   * Row-level security is on for every table.
--   * Only the server (service role, inside /api/check) writes finds and visits,
--     so nobody can give themselves points.
--   * Public reads (scoreboard, density, request queue) go through functions that
--     return counts and display names only: no emails, no user ids.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text unique not null check (char_length(display_name) between 3 and 20),
  created_at timestamptz not null default now()
);
-- "Nova" and "nova" are the same name on a scoreboard.
create unique index profiles_display_name_lower_idx on public.profiles (lower(display_name));

create table public.finds (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,   -- null: a guest's quick-look candidate
  spot_slug text not null,
  ra double precision not null,
  dec double precision not null,
  hpx12 bigint not null,                                   -- HEALPix NESTED, order 12
  x real, y real, vx_px_day real, vy_px_day real,
  verdict text not null check (verdict in
    ('known', 'bot_match', 'candidate', 'static', 'nothing_correct', 'nothing_wrong')),
  object_name text,
  points int not null default 0 check (points >= 0),
  first_finder boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.visits (                               -- the "Checked" layer
  user_id uuid not null references auth.users on delete cascade,
  spot_slug text not null,
  hpx12 bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_slug)
);

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
create index finds_user_spot_idx on public.finds (user_id, spot_slug);   -- also covers the user_id foreign key
create index finds_spot_idx on public.finds (spot_slug);
-- At most one first finder per object in a spot, even if two players submit at once.
create unique index finds_first_finder_idx on public.finds (spot_slug, object_name) where first_finder;
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
-- A taken name fails the sign-up; the form checks display_name_available() first.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(new.raw_user_meta_data ->> 'display_name');
begin
  if v_name is not null and char_length(v_name) between 3 and 20 then
    insert into public.profiles (id, display_name) values (new.id, v_name);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.display_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p where lower(p.display_name) = lower(btrim(p_name))
  );
$$;

-- ---------------------------------------------------------------- public reads

-- Scoreboard. p_slug null = all time. Returns the top p_limit rows, plus the caller's
-- own row if they are further down. Accuracy = correct submissions / all submissions.
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
           (count(*) filter (where f.verdict in ('known', 'bot_match', 'nothing_correct')))::numeric
             / count(*) as accuracy
    from public.finds f
    where f.user_id is not null
      and (p_slug is null or f.spot_slug = p_slug)
    group by f.user_id
  ),
  r as (
    select rank() over (order by s.score desc, s.accuracy desc) as rank, s.user_id, s.score, s.accuracy
    from s
  )
  select r.rank, p.display_name, r.score, round(r.accuracy, 3),
         coalesce(r.user_id = (select auth.uid()), false)
  from r
  join public.profiles p on p.id = r.user_id
  where r.rank <= least(greatest(p_limit, 1), 200)
     or r.user_id = (select auth.uid())
  order by r.rank, p.display_name;
$$;

-- Density layers on the HEALPix tree. In NESTED order a parent cell is the child index
-- shifted right by 2 bits per level, so the stored order 12 serves every zoom level.
-- p_layer: 'finds' (one count per marked mover) or 'checked' (one count per player per spot).
-- p_mine: only the caller's rows (empty for guests).
create function public.density(p_layer text, p_order int default 4, p_mine boolean default false)
returns table (ipix bigint, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.hpx12 >> (2 * (12 - p_order)), count(*)
  from public.finds f
  where p_layer = 'finds'
    and p_order between 0 and 12
    and f.verdict in ('known', 'bot_match', 'candidate')
    and (not p_mine or f.user_id = (select auth.uid()))
  group by 1
  union all
  select v.hpx12 >> (2 * (12 - p_order)), count(*)
  from public.visits v
  where p_layer = 'checked'
    and p_order between 0 and 12
    and (not p_mine or v.user_id = (select auth.uid()))
  group by 1;
$$;

-- The request queue for /requests: positions and status only.
create function public.spot_request_queue(p_limit int default 100)
returns table (id bigint, ra double precision, dec double precision, fov real, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.ra, q.dec, q.fov, q.status, q.created_at
  from public.spot_requests q
  order by q.created_at desc
  limit least(greatest(p_limit, 1), 100);
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
-- in one transaction, saves the find and marks the spot as checked.
-- p_points is the base score computed by the server; p_bonus is added only for a first finder.
create function public.record_find(
  p_user uuid, p_spot text, p_ra double precision, p_dec double precision, p_hpx12 bigint,
  p_x real, p_y real, p_vx real, p_vy real,
  p_verdict text, p_object_name text, p_points int, p_bonus int
)
returns table (first_finder boolean, already_found boolean, points int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scoring boolean := p_verdict in ('known', 'bot_match', 'nothing_correct');
  v_key text := coalesce(p_object_name, p_verdict);   -- what "the same find" means in a spot
  v_first boolean := false;
  v_already boolean := false;
  v_points int := 0;
begin
  -- One submission at a time per object in a spot.
  perform pg_advisory_xact_lock(hashtextextended(p_spot || '/' || v_key, 0));

  if v_scoring and p_user is not null then
    select exists (
      select 1 from public.finds f
      where f.user_id = p_user and f.spot_slug = p_spot
        and f.verdict = p_verdict
        and coalesce(f.object_name, f.verdict) = v_key
    ) into v_already;

    if not v_already then
      v_points := greatest(p_points, 0);
      if p_verdict = 'known' and p_object_name is not null then
        select not exists (
          select 1 from public.finds f
          where f.spot_slug = p_spot and f.object_name = p_object_name and f.first_finder
        ) into v_first;
        if v_first then
          v_points := v_points + greatest(p_bonus, 0);
        end if;
      end if;
    end if;
  end if;

  insert into public.finds
    (user_id, spot_slug, ra, dec, hpx12, x, y, vx_px_day, vy_px_day, verdict, object_name, points, first_finder)
  values
    (p_user, p_spot, p_ra, p_dec, p_hpx12, p_x, p_y, p_vx, p_vy, p_verdict, p_object_name, v_points, v_first);

  if p_user is not null then
    insert into public.visits (user_id, spot_slug, hpx12)
    values (p_user, p_spot, p_hpx12)
    on conflict (user_id, spot_slug) do nothing;
  end if;

  return query select v_first, v_already, v_points;
end;
$$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function
  public.handle_new_user(),
  public.display_name_available(text),
  public.leaderboard(text, int),
  public.density(text, int, boolean),
  public.spot_request_queue(int),
  public.ping(),
  public.record_find(uuid, text, double precision, double precision, bigint, real, real, real, real, text, text, int, int)
from public, anon, authenticated;

grant execute on function
  public.display_name_available(text),
  public.leaderboard(text, int),
  public.density(text, int, boolean),
  public.spot_request_queue(int),
  public.ping()
to anon, authenticated, service_role;

grant execute on function
  public.record_find(uuid, text, double precision, double precision, bigint, real, real, real, real, text, text, int, int)
to service_role;
