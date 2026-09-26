-- 006_egg_wastages.sql — the wastage ledger the app gained in persist v17.
--
-- Eggs thrown away: a stock event with no money in it, recorded per grade because each pool
-- is a different loss. Same shape as egg_collections minus the money the store never attaches,
-- plus the farm's own reason. P&L never reads it; only the four grade pools move.

create table if not exists public.egg_wastages (
  id           text primary key,
  company_id   text not null references public.companies (id) on delete cascade,
  batch_id     text not null references public.batches (id) on delete restrict,
  shed_id      text not null references public.sheds (id) on delete restrict,
  date         date not null,
  good_trays   integer not null default 0 check (good_trays >= 0),
  broken_trays integer not null default 0 check (broken_trays >= 0),
  double_trays integer not null default 0 check (double_trays >= 0),
  small_trays  integer not null default 0 check (small_trays >= 0),
  reason       text not null default '',
  remarks      text,
  worker_name  text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz
);
create index if not exists egg_wastages_company_date_idx on public.egg_wastages (company_id, date);
create index if not exists egg_wastages_shed_idx on public.egg_wastages (shed_id, date);

grant select, insert, update, delete on public.egg_wastages to authenticated;
alter table public.egg_wastages enable row level security;

-- The daily record of a company's own birds, exactly the egg_collections grant: every member
-- reads it, only the daily-ops role writes it, and the row's own company decides.
drop policy if exists company_select on public.egg_wastages;
create policy company_select on public.egg_wastages
  for select to authenticated using (app.member_of(public.egg_wastages.company_id));

drop policy if exists company_insert on public.egg_wastages;
create policy company_insert on public.egg_wastages
  for insert to authenticated with check (app.role_can(public.egg_wastages.company_id, 'createDailyOps'));

drop policy if exists company_update on public.egg_wastages;
create policy company_update on public.egg_wastages
  for update to authenticated
  using (app.role_can(public.egg_wastages.company_id, 'update'))
  with check (app.role_can(public.egg_wastages.company_id, 'update'));

drop policy if exists company_delete on public.egg_wastages;
create policy company_delete on public.egg_wastages
  for delete to authenticated using (app.role_can(public.egg_wastages.company_id, 'delete'));

-- A wastage row that records no discarded tray moves nothing; refuse the empty write too.
alter table public.egg_wastages drop constraint if exists egg_wastages_not_empty;
alter table public.egg_wastages
  add constraint egg_wastages_not_empty
  check (good_trays + broken_trays + double_trays + small_trays > 0);

-- v_egg_stock (002) predates this ledger and read stock as collected − billed. The app has
-- always subtracted discarded trays too (src/lib/calc.ts · eggStockByGrade), so the view now
-- agrees with the screen it mirrors. It gains a column, which a replace cannot do, so it is
-- rebuilt; nothing else in the schema reads it.
drop view if exists public.v_egg_stock;
create or replace view v_egg_stock as
with collected as (
  select c.company_id, c.shed_id, g.grade, sum(g.trays) as trays
  from public.egg_collections c
  cross join lateral (values
    ('GOOD',   c.good_trays),
    ('BROKEN', c.broken_trays),
    ('DOUBLE', c.double_trays),
    ('SMALL',  c.small_trays)
  ) as g(grade, trays)
  where c.date <= current_date and g.trays > 0
  group by 1, 2, 3
),
sold as (
  select d.company_id, l.shed_id, g.grade, sum(g.trays) as trays
  from v_sale_entry_day d
  join public.sale_entry_lines l on l.sale_entry_id = d.sale_entry_id
  cross join lateral (values
    ('GOOD',   l.good_trays),
    ('BROKEN', l.broken_trays),
    ('DOUBLE', l.double_trays),
    ('SMALL',  l.small_trays)
  ) as g(grade, trays)
  where d.date <= current_date and g.trays > 0
  group by 1, 2, 3
),
wasted as (
  select w.company_id, w.shed_id, g.grade, sum(g.trays) as trays
  from public.egg_wastages w
  cross join lateral (values
    ('GOOD',   w.good_trays),
    ('BROKEN', w.broken_trays),
    ('DOUBLE', w.double_trays),
    ('SMALL',  w.small_trays)
  ) as g(grade, trays)
  where w.date <= current_date and g.trays > 0
  group by 1, 2, 3
),
grades as (
  select shed.company_id, shed.id as shed_id, g.grade
  from public.sheds shed
  cross join (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) as g(grade)
)
select
  gr.company_id,
  gr.shed_id,
  sh.name  as shed_name,
  gr.grade,
  coalesce(c.trays, 0)                                                  as collected,
  coalesce(s.trays, 0)                                                  as dispatched,
  coalesce(w.trays, 0)                                                  as wasted,
  coalesce(c.trays, 0) - coalesce(s.trays, 0) - coalesce(w.trays, 0)    as balance
from grades gr
join public.sheds sh on sh.id = gr.shed_id
left join collected c on c.shed_id = gr.shed_id and c.grade = gr.grade
left join sold s on s.shed_id = gr.shed_id and s.grade = gr.grade
left join wasted w on w.shed_id = gr.shed_id and w.grade = gr.grade;

-- Rebuilding a view drops its grants, and 002 handed `all tables` (views included) to
-- authenticated once; give the fresh one back the same ceiling it had. RLS on the base tables
-- is what actually scopes the rows.
grant select on public.v_egg_stock to authenticated;
