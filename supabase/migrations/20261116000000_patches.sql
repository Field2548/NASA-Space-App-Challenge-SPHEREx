-- Picked patches (any point on the sky map played like a stage). Owner: SERVER.
-- Written only by the server with the service role (POST /api/patch-check); read by the server
-- for GET /api/patches. Nobody else may read or write: RLS on, no policies, no grants.
--
-- patch_solves: one row per correct answer on a patch. `objects` holds the known objects' sky
-- positions only ([{ "ra": .., "dec": .. }], one point per object per checked frame), never names,
-- because the map shows solved patches to everyone and a name stays hidden until a player answers.
-- patch_reports: marks that matched no known object ("possible new mover"), with the frame times.

create table public.patch_solves (
  id bigint generated always as identity primary key,
  patch_id text not null check (patch_id ~ '^p11-[0-9]{1,8}$'),
  user_id uuid references auth.users on delete set null,   -- null: a guest
  ra double precision not null,                             -- patch centre
  dec double precision not null,
  objects jsonb not null default '[]'::jsonb check (jsonb_typeof(objects) = 'array'),
  created_at timestamptz not null default now()
);
comment on table public.patch_solves is
  'One row per correct /api/patch-check answer. objects: [{ra, dec}] positions only, no names.';

-- One solve per player per patch (guests are not de-duplicated: there is no one to key on).
create unique index patch_solves_patch_user_idx on public.patch_solves (patch_id, user_id) where user_id is not null;
create index patch_solves_dec_idx on public.patch_solves (dec);

create table public.patch_reports (
  id bigint generated always as identity primary key,
  patch_id text not null check (patch_id ~ '^p11-[0-9]{1,8}$'),
  user_id uuid references auth.users on delete set null,   -- null: a guest
  ra double precision not null,                             -- patch centre
  dec double precision not null,
  -- [{ "frame", "x", "y", "ra", "dec", "mjd" }]: the player's marks, in pixels and on the sky.
  marks jsonb not null check (jsonb_typeof(marks) = 'array'),
  -- [{ "i", "mjd" }]: every frame of the patch as the player saw it.
  frame_times jsonb not null check (jsonb_typeof(frame_times) = 'array'),
  created_at timestamptz not null default now()
);
comment on table public.patch_reports is
  'Marks on a picked patch that matched no known JPL object: possible new movers, unconfirmed.';

create index patch_reports_dec_idx on public.patch_reports (dec);
create index patch_reports_patch_idx on public.patch_reports (patch_id);

alter table public.patch_solves enable row level security;
alter table public.patch_reports enable row level security;
-- No policies: only the service role (which bypasses RLS) touches these tables.
revoke all on public.patch_solves, public.patch_reports from anon, authenticated;
revoke all on sequence public.patch_solves_id_seq, public.patch_reports_id_seq from anon, authenticated;
