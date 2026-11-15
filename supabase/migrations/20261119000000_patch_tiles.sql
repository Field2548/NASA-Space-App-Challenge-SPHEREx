-- Community patches layer: level-of-detail tiles over the picked patches. Owner: SERVER.
--
-- hpx11 is the patch's HEALPix order-11 NESTED index (the number in `p11-<ipix>`), stored as a
-- generated column so every old and new row has it with no change to the insert code. Because
-- NESTED indices keep a parent cell's children together, "all patches inside tile T at order k" is
-- one contiguous range of hpx11, which the btree index serves.
--
-- Read only through the two functions below, called by the server with the service role
-- (GET /api/patch-tiles). They return counts and patch ids, never user ids, names or positions.

alter table public.patch_solves
  add column hpx11 bigint generated always as (substring(patch_id from 5)::bigint) stored;
alter table public.patch_reports
  add column hpx11 bigint generated always as (substring(patch_id from 5)::bigint) stored;

create index patch_solves_hpx11_idx on public.patch_solves (hpx11);
create index patch_reports_hpx11_idx on public.patch_reports (hpx11);

-- Patches inside tile p_tile (a cell at order p_tile_order), counted per cell at order p_order
-- (p_tile_order <= p_order <= 11). A patch solved or reported by many players counts once.
create function public.patch_density(p_order int, p_tile_order int, p_tile bigint)
returns table (ipix bigint, solves int, reports int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_span int;   -- bit shift from an order-11 index to the tile's range
  v_lo bigint;
  v_hi bigint;
  v_cell int;   -- bit shift from an order-11 index to a cell at p_order
begin
  if p_tile_order is null or p_tile_order < 0 or p_tile_order > 11
     or p_order is null or p_order < p_tile_order or p_order > 11
     or p_tile is null or p_tile < 0 or p_tile >= 12 * (1::bigint << (2 * p_tile_order)) then
    raise exception 'patch_density: bad arguments' using errcode = '22023';
  end if;
  v_span := 2 * (11 - p_tile_order);
  v_cell := 2 * (11 - p_order);
  v_lo := p_tile << v_span;
  v_hi := ((p_tile + 1) << v_span) - 1;
  return query
    with s as (
      select (hpx11 >> v_cell) as c, count(distinct patch_id) as n
      from public.patch_solves where hpx11 between v_lo and v_hi group by 1
    ), r as (
      select (hpx11 >> v_cell) as c, count(distinct patch_id) as n
      from public.patch_reports where hpx11 between v_lo and v_hi group by 1
    )
    select coalesce(s.c, r.c)::bigint, coalesce(s.n, 0)::int, coalesce(r.n, 0)::int
    from s full join r on s.c = r.c;
end;
$$;

-- The patches inside tile p_tile at p_tile_order, one row each, with whether anyone solved and/or
-- reported it. At most p_limit rows (capped at 1000), lowest index first.
create function public.patch_footprints(p_tile_order int, p_tile bigint, p_limit int default 600)
returns table (patch_id text, has_solve boolean, has_report boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_span int;
  v_lo bigint;
  v_hi bigint;
begin
  if p_tile_order is null or p_tile_order < 0 or p_tile_order > 11
     or p_tile is null or p_tile < 0 or p_tile >= 12 * (1::bigint << (2 * p_tile_order)) then
    raise exception 'patch_footprints: bad arguments' using errcode = '22023';
  end if;
  v_span := 2 * (11 - p_tile_order);
  v_lo := p_tile << v_span;
  v_hi := ((p_tile + 1) << v_span) - 1;
  return query
    select 'p11-' || u.hpx11::text, bool_or(u.s), bool_or(u.r)
    from (
      select hpx11, true as s, false as r from public.patch_solves where hpx11 between v_lo and v_hi
      union all
      select hpx11, false, true from public.patch_reports where hpx11 between v_lo and v_hi
    ) u
    group by u.hpx11
    order by u.hpx11
    limit greatest(1, least(coalesce(p_limit, 600), 1000));
end;
$$;

revoke all on function public.patch_density(int, int, bigint) from public, anon, authenticated;
revoke all on function public.patch_footprints(int, bigint, int) from public, anon, authenticated;
grant execute on function public.patch_density(int, int, bigint) to service_role;
grant execute on function public.patch_footprints(int, bigint, int) to service_role;
