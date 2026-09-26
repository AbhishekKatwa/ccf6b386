-- 014_shed_geometry.sql — the farm site plan gets somewhere to live.
--
-- The layout editor (src/screens/FarmLayoutScreen.tsx) draws one object per shed on a
-- rectangular plot and stores six numbers with it: where it stands, which way it faces, and
-- what it measures. React owns those values; this migration only gives them columns, so the
-- existing sync engine (src/services/supabase/push.ts) carries them the same way it carries a
-- shed's name — and the row-level security, company isolation and delete guards of 003 keep
-- working without a single new policy.
--
-- Deliberately absent:
--   * no new table. A shed's place is a property of the shed.
--   * no NOT NULL. Every shed in the database predates the editor; the app derives a resting
--     position from the shed's index on its farm (lib/shedLayout.ts, autoPlace) whenever these
--     columns are null, so nothing had to be back-filled and no shed moved on the way in.
--   * no business logic. Capacity, birds, feed and money stay exactly where they were; the
--     metres below are a drawing of the site, not a record of the flock.
--
-- The checks are the app's own limits (lib/shedLayout.ts, LIMITS), stated as numbers rather
-- than sentences: a bad write from anywhere is a rejected write, and a shed cannot be given
-- a negative footprint. `rotation_deg` stays inside one turn because the client normalises it
-- the same way, so the two sides never disagree about what 405° means.
--
-- farms keeps its plot size for the same reason: the working plane is a property of the farm,
-- and the editor clamps every shed inside it.

-- ============================= 1 · SHED PLACEMENT AND DIMENSIONS =============================

alter table public.sheds
  add column if not exists layout_x    numeric,
  add column if not exists layout_y    numeric,
  add column if not exists rotation_deg numeric,
  add column if not exists length_m    numeric,
  add column if not exists width_m     numeric,
  add column if not exists height_m    numeric;

alter table public.sheds drop constraint if exists sheds_layout_x_finite;
alter table public.sheds drop constraint if exists sheds_layout_y_finite;
alter table public.sheds drop constraint if exists sheds_rotation_range;
alter table public.sheds drop constraint if exists sheds_length_range;
alter table public.sheds drop constraint if exists sheds_width_range;
alter table public.sheds drop constraint if exists sheds_height_range;

alter table public.sheds
  add constraint sheds_layout_x_finite check (layout_x is null or layout_x = round(layout_x, 3)),
  add constraint sheds_layout_y_finite check (layout_y is null or layout_y = round(layout_y, 3)),
  add constraint sheds_rotation_range  check (rotation_deg is null or (rotation_deg >= 0 and rotation_deg < 360)),
  add constraint sheds_length_range    check (length_m   is null or (length_m   between 6  and 250)),
  add constraint sheds_width_range     check (width_m    is null or (width_m    between 3  and 120)),
  add constraint sheds_height_range    check (height_m   is null or (height_m   between 2  and 20));

comment on column public.sheds.layout_x is
  'Metres along the farm plot from its centre, positive toward the east edge. Null means the '
  'shed has never been placed and the app derives a position from its order on the farm.';
comment on column public.sheds.layout_y is
  'Metres across the farm plot from its centre, positive toward the south edge. Three.js draws '
  'the same value on world -Z, which is what makes the plan view read like a plan.';
comment on column public.sheds.rotation_deg is
  'Heading of the shed''s long axis, 0-359°, counter-clockwise on the plan. The editor turns in '
  '15° steps; the number itself is continuous so a hand-written value is still honoured.';
comment on column public.sheds.length_m is
  'Footprint length along the shed''s own long axis, in metres. A drawing measurement, not a '
  'bird count — capacity remains the operational figure.';
comment on column public.sheds.width_m is 'Footprint width across the shed, in metres.';
comment on column public.sheds.height_m is
  'Wall plus roof height, in metres. The scene splits it 72% wall / 28% gable so a resize '
  'keeps the silhouette of a poultry house.';

-- ============================= 2 · THE FARM'S WORKING PLANE =============================

alter table public.farms
  add column if not exists plot_length_m numeric,
  add column if not exists plot_width_m  numeric;

alter table public.farms drop constraint if exists farms_plot_range;
alter table public.farms
  add constraint farms_plot_range check (
    (plot_length_m is null or plot_length_m between 60 and 2000) and
    (plot_width_m  is null or plot_width_m  between 40 and 2000)
  );

comment on column public.farms.plot_length_m is
  'The rectangular site the sheds are arranged on, in metres, measured along its long axis. '
  'Null falls back to lib/shedLayout.ts DEFAULT_PLOT (300 m).';
comment on column public.farms.plot_width_m is
  'The same site across. Sheds are clamped inside this boundary by the editor.';
