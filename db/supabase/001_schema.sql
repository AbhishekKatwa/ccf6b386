-- 001_schema.sql — AMRUT Poultry Farm: tables, types and constraints.
--
-- Conventions, all of them forced by the client model this replaces:
--   * TEXT primary keys for business rows: ids are generated app-side by uid(prefix)
--     (src/lib/format.ts) and are cross-referenced as free-standing strings
--     (trader_txns.ref_id -> sale_entries.id), so they must survive import unchanged.
--   * UUID only where the row IS a person, referencing public.profiles -> auth.users.
--   * date for the app's YYYY-MM-DD business dates, time for HH:mm clock times,
--     timestamptz for ISO instants.
--   * numeric(14,2) money, numeric(10,4) per-egg and per-kg rates, numeric(12,3) for
--     kg/tonnes/units, integer for trays, birds and counts.
--   * `synced` is gone: it only meant "not yet uploaded" while the store was localStorage.
--   * Kind columns are TEXT + CHECK, not CREATE TYPE: ALTER TYPE ADD VALUE cannot run in a
--     transaction, and SHORTAGE / RATE_UPDATE each arrived later on the client.
--   * Ledger quantities carry no sign CHECK. stockDelta() (src/lib/calc.ts) decides the
--     effect per kind — FEED_OUT/CONSUMPTION store a positive figure and subtract,
--     SHORTAGE subtracts however it was typed, ADJUSTMENT is signed as entered.

-- ============================= TENANCY =============================

create table if not exists public.companies (
  id         text primary key,
  name       text not null check (length(btrim(name)) > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/** One row per auth.users: the app's role and mobile, plus the pre-Supabase id it came from. */
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  legacy_id  text unique,
  name       text not null check (length(btrim(name)) > 0),
  mobile     text not null unique,
  role       text not null check (role in (
               'MASTER_ADMIN','OWNER','FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR')),
  initials   text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/** Replaces User.companyIds[]: which companies a person may enter, and as what. */
create table if not exists public.company_users (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  role       text not null check (role in (
               'MASTER_ADMIN','OWNER','FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR')),
  primary key (user_id, company_id)
);
create index if not exists company_users_company_idx on public.company_users (company_id);

/** Platform-wide inbox from Contact & help; readable only by the Master Admin. */
create table if not exists public.support_messages (
  id         text primary key,
  company_id text references public.companies (id) on delete set null,
  user_id    uuid references public.profiles (id) on delete set null,
  name       text not null,
  mobile     text,
  subject    text,
  message    text not null,
  role       text,
  at         timestamptz not null default now(),
  handled_at timestamptz,
  /** The platform person's name as the app writes it (markSupportHandled), not a profile id. */
  handled_by text
);

-- ============================= FLOCK =============================

create table if not exists public.farms (
  id             text primary key,
  company_id     text not null references public.companies (id) on delete cascade,
  name           text not null check (length(btrim(name)) > 0),
  location       text not null default '',
  contact_mobile text not null default '',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists farms_company_idx on public.farms (company_id);

create table if not exists public.sheds (
  id                     text primary key,
  company_id             text not null references public.companies (id) on delete cascade,
  farm_id                text not null references public.farms (id) on delete restrict,
  name                   text not null check (length(btrim(name)) > 0),
  capacity               integer not null check (capacity > 0),
  status                 text not null default 'IDLE' check (status in ('ACTIVE','IDLE','MAINTENANCE')),
  farm_supervisor_id     uuid references public.profiles (id) on delete set null,
  financial_supervisor_id uuid references public.profiles (id) on delete set null,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists sheds_company_idx on public.sheds (company_id);
create index if not exists sheds_farm_idx on public.sheds (farm_id);

/** A placed flock. `closing` lives in batch_closings; nothing here restates bird counts. */
create table if not exists public.batches (
  id                    text primary key,
  company_id            text not null references public.companies (id) on delete cascade,
  farm_id               text not null references public.farms (id) on delete restrict,
  shed_id               text not null references public.sheds (id) on delete restrict,
  code                  text not null,
  bird_type             text not null check (bird_type in ('LAYER','BROILER')),
  breed                 text not null default '',
  hatch_date            date,
  placement_date        date not null,
  start_date            date not null,
  initial_birds         integer not null check (initial_birds > 0),
  status                text not null default 'ACTIVE' check (status in ('ACTIVE','CLOSED','PLANNED')),
  -- Planning figure only: it feeds the days-of-stock forecast and never moves stock.
  approximate_feed_tpd  numeric(12,3),
  manager_id            uuid references public.profiles (id) on delete set null,
  supervisor_id         uuid references public.profiles (id) on delete set null,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists batches_company_idx on public.batches (company_id);
create index if not exists batches_shed_idx on public.batches (shed_id, status);

/** The one closing record a batch may carry, kept apart so an open batch stays clean. */
create table if not exists public.batch_closings (
  batch_id   text primary key references public.batches (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  date       date not null,
  final_birds integer not null check (final_birds >= 0),
  buyer      text,
  amount     numeric(14,2),
  remarks    text,
  closed_by  uuid references public.profiles (id) on delete set null,
  closed_at  timestamptz not null default now()
);

/**
 * Per-batch grants. `permissions` stays one jsonb column rather than eighteen: it is
 * copied wholesale from the role defaults, compared as a set, and never queried by key.
 */
create table if not exists public.batch_assignments (
  id           text primary key,
  company_id   text not null references public.companies (id) on delete cascade,
  batch_id     text not null references public.batches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in (
                 'MASTER_ADMIN','OWNER','FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR')),
  permissions  jsonb not null default '{}'::jsonb,
  comments     text,
  assigned_by  uuid references public.profiles (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  unique (batch_id, user_id, role)
);
create index if not exists batch_assignments_company_idx on public.batch_assignments (company_id);
create index if not exists batch_assignments_user_idx on public.batch_assignments (user_id);

create table if not exists public.mortality (
  id          text primary key,
  company_id  text not null references public.companies (id) on delete cascade,
  batch_id    text not null references public.batches (id) on delete restrict,
  shed_id     text not null references public.sheds (id) on delete restrict,
  date        date not null,
  count       integer not null check (count >= 0),
  worker_name text,
  remarks     text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz
);
create index if not exists mortality_company_date_idx on public.mortality (company_id, date);
create index if not exists mortality_batch_idx on public.mortality (batch_id, date);

-- ============================= VACCINATION =============================

create table if not exists public.vaccination_templates (
  id         text primary key,
  company_id text not null references public.companies (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  bird_type  text check (bird_type in ('LAYER','BROILER')),
  active     boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vaccination_templates_company_idx on public.vaccination_templates (company_id);

/** Copied into a batch at placement; the template keeps no live link to what used it. */
create table if not exists public.vaccination_template_items (
  template_id         text not null references public.vaccination_templates (id) on delete cascade,
  position            integer not null,
  relative_day        integer not null check (relative_day >= 0),
  vaccine_name        text not null check (length(btrim(vaccine_name)) > 0),
  reminder_days_before integer not null default 0 check (reminder_days_before >= 0),
  dose                text,
  route               text,
  remarks             text,
  primary key (template_id, position)
);

/** Only three states are stored; OVERDUE / DUE_TODAY / DUE_SOON are read off scheduled_date. */
create table if not exists public.vaccinations (
  id                   text primary key,
  company_id           text not null references public.companies (id) on delete cascade,
  batch_id             text not null references public.batches (id) on delete cascade,
  shed_id              text not null references public.sheds (id) on delete restrict,
  relative_day         integer not null check (relative_day >= 0),
  vaccine_name         text not null check (length(btrim(vaccine_name)) > 0),
  scheduled_date       date not null,
  reminder_days_before integer not null default 0 check (reminder_days_before >= 0),
  dose                 text,
  route                text,
  remarks              text,
  status               text not null default 'SCHEDULED' check (status in ('SCHEDULED','COMPLETED','CANCELLED')),
  completed_date       date,
  completed_at         timestamptz,
  /** A name typed on the sheet (src/types: completedBy?: string), like medicine's used_by. */
  completed_by         text,
  actual_dose          text,
  completion_remarks   text,
  cancelled_at         timestamptz,
  cancelled_by         text,
  cancellation_reason  text,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Completion and cancellation are each a single, dated fact.
  check (status <> 'COMPLETED' or completed_date is not null),
  check (status <> 'CANCELLED' or cancellation_reason is not null)
);
create index if not exists vaccinations_company_date_idx on public.vaccinations (company_id, scheduled_date);
create index if not exists vaccinations_batch_idx on public.vaccinations (batch_id, scheduled_date);

-- ============================= EGGS AND SALES =============================

/** Daily collection, recorded in trays per grade. Adds to that grade's shed pool. */
create table if not exists public.egg_collections (
  id           text primary key,
  company_id   text not null references public.companies (id) on delete cascade,
  batch_id     text not null references public.batches (id) on delete restrict,
  shed_id      text not null references public.sheds (id) on delete restrict,
  date         date not null,
  good_trays   integer not null default 0 check (good_trays >= 0),
  broken_trays integer not null default 0 check (broken_trays >= 0),
  double_trays integer not null default 0 check (double_trays >= 0),
  small_trays  integer not null default 0 check (small_trays >= 0),
  worker_name  text,
  remarks      text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz
);
create index if not exists egg_collections_company_date_idx on public.egg_collections (company_id, date);
create index if not exists egg_collections_shed_idx on public.egg_collections (shed_id, date);

/**
 * Shed dispatch note: what left with the vehicle. It moves no stock — the trader's
 * pools drop only when accounts saves the sale entry — so `acknowledged_*` is the only
 * state it can reach.
 */
create table if not exists public.sale_logs (
  id              text primary key,
  company_id      text not null references public.companies (id) on delete cascade,
  shed_id         text not null references public.sheds (id) on delete restrict,
  batch_id        text not null references public.batches (id) on delete restrict,
  date            date not null,
  trays           integer not null check (trays > 0),
  grade           text not null check (grade in ('GOOD','BROKEN','DOUBLE','SMALL')),
  status          text not null default 'PENDING' check (status in ('PENDING','ACKNOWLEDGED')),
  worker_name     text,
  remarks         text,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_at timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  -- There is no id from a dispatch note to a voucher: accounts matches them by
  -- company, shed, grade and date. That link is deliberately not invented here.
  check (status <> 'ACKNOWLEDGED' or acknowledged_at is not null)
);
create index if not exists sale_logs_company_date_idx on public.sale_logs (company_id, date);
create index if not exists sale_logs_shed_idx on public.sale_logs (shed_id, date, grade);

/**
 * The voucher: the day's final sale of the eggs, where stock drops and money is booked.
 * `credit` is NOT a column — the store derives it as eggs + labour - cash - online -
 * advance, so it lives in v_sale_entry_position.
 */
create table if not exists public.sale_entries (
  id                text primary key,
  company_id        text not null references public.companies (id) on delete cascade,
  trader_id         text not null,
  date              date not null,
  pricing           text not null default 'RATE' check (pricing in ('RATE','AGREED')),
  rate_good         numeric(10,4) check (rate_good is null or rate_good >= 0),
  rate_broken       numeric(10,4) check (rate_broken is null or rate_broken >= 0),
  rate_double       numeric(10,4) check (rate_double is null or rate_double >= 0),
  rate_small        numeric(10,4) check (rate_small is null or rate_small >= 0),
  amount            numeric(14,2) not null default 0 check (amount >= 0),
  cash              numeric(14,2) not null default 0 check (cash >= 0),
  phonepe           numeric(14,2) not null default 0 check (phonepe >= 0),
  advance           numeric(14,2) not null default 0 check (advance >= 0),
  labor_charge      numeric(14,2) not null default 0 check (labor_charge >= 0),
  cash_handled_by   uuid references public.profiles (id) on delete set null,
  cash_time         time,
  cash_reference    text,
  remarks           text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz
);
create index if not exists sale_entries_company_date_idx on public.sale_entries (company_id, date);
create index if not exists sale_entries_trader_idx on public.sale_entries (trader_id, date);

/** One shed's contribution; these trays leave that shed's grade pools. */
create table if not exists public.sale_entry_lines (
  sale_entry_id text not null references public.sale_entries (id) on delete cascade,
  position      integer not null,
  shed_id       text not null references public.sheds (id) on delete restrict,
  good_trays    integer not null default 0 check (good_trays >= 0),
  broken_trays  integer not null default 0 check (broken_trays >= 0),
  double_trays  integer not null default 0 check (double_trays >= 0),
  small_trays   integer not null default 0 check (small_trays >= 0),
  primary key (sale_entry_id, position),
  -- normalizeLines() drops a shed that sells nothing; the database refuses it too.
  check (good_trays + broken_trays + double_trays + small_trays > 0)
);
create index if not exists sale_entry_lines_shed_idx on public.sale_entry_lines (shed_id);

/** A promise to a trader. Never reduces stock, never books income, never creates money. */
create table if not exists public.egg_sale_bookings (
  id            text primary key,
  company_id    text not null references public.companies (id) on delete cascade,
  shed_id       text not null references public.sheds (id) on delete restrict,
  batch_id      text references public.batches (id) on delete set null,
  date          date not null,
  trader_id     text not null,
  planned_trays integer not null check (planned_trays > 0),
  grade         text not null check (grade in ('GOOD','BROKEN','DOUBLE','SMALL')),
  status        text not null default 'PLANNED' check (status in ('PLANNED','FULFILLED','CANCELLED')),
  remarks       text,
  sale_entry_id text references public.sale_entries (id) on delete set null,
  fulfilled_at  timestamptz,
  cancel_reason text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz,
  -- A cancelled booking keeps its record and its reason; plans are never deleted.
  check (status <> 'FULFILLED' or sale_entry_id is not null),
  check (status <> 'CANCELLED' or cancel_reason is not null)
);
create index if not exists egg_sale_bookings_company_date_idx on public.egg_sale_bookings (company_id, date);
create index if not exists egg_sale_bookings_status_idx on public.egg_sale_bookings (company_id, status);

-- ============================= GODOWN AND FEED =============================

/**
 * Global ingredient catalogue, shared by every company: this is the app's
 * `ingredientCatalog: string[]`, so it carries no company id and no row id either.
 */
create table if not exists public.ingredients (
  name       text primary key check (length(btrim(name)) > 0),
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

/**
 * The godown ledger. qty_kg is unsigned-except-for-adjustment on purpose (see header):
 * the sign of the effect comes from the kind, replayed in v_godown_stock.
 */
create table if not exists public.feed_stock (
  id           text primary key,
  company_id   text not null references public.companies (id) on delete cascade,
  ingredient   text not null check (length(btrim(ingredient)) > 0),
  date         date not null,
  kind         text not null check (kind in ('OPENING','FEED_IN','FEED_OUT','CONSUMPTION','ADJUSTMENT','SHORTAGE')),
  qty_kg       numeric(12,3) not null check (qty_kg <> 0),
  rate_per_kg  numeric(10,4) check (rate_per_kg is null or rate_per_kg >= 0),
  shed_id      text references public.sheds (id) on delete set null,
  batch_id     text references public.batches (id) on delete set null,
  supplier     text,
  purchase_ref text,
  remarks      text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists feed_stock_company_date_idx on public.feed_stock (company_id, date);
create index if not exists feed_stock_ingredient_idx on public.feed_stock (company_id, ingredient, date);
/** A stock receipt number is unique per company, so a payable can never be paid twice. */
create unique index if not exists feed_stock_purchase_ref_uq
  on public.feed_stock (company_id, purchase_ref) where purchase_ref is not null;

/** Per-shed mix, expressed as KG per 1000 KG. Versions of one recipe share a family. */
create table if not exists public.feed_formulas (
  id             text primary key,
  company_id     text not null references public.companies (id) on delete cascade,
  shed_id        text not null references public.sheds (id) on delete restrict,
  name           text not null check (length(btrim(name)) > 0),
  family_id      text not null,
  version        integer not null check (version >= 1),
  effective_from date not null,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  change_reason  text,
  superseded_at  timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (family_id, version)
);
create index if not exists feed_formulas_company_idx on public.feed_formulas (company_id, shed_id);

create table if not exists public.feed_formula_items (
  formula_id   text not null references public.feed_formulas (id) on delete cascade,
  position     integer not null,
  ingredient   text not null check (length(btrim(ingredient)) > 0),
  kg_per_tonne numeric(12,3) not null check (kg_per_tonne >= 0),
  primary key (formula_id, position)
);

/**
 * Feed actually eaten, in tonnes, with the formula version that priced it frozen onto the
 * row — a later revision must never revalue a past day.
 */
create table if not exists public.feed_consumption (
  id              text primary key,
  company_id      text not null references public.companies (id) on delete cascade,
  shed_id         text not null references public.sheds (id) on delete restrict,
  batch_id        text not null references public.batches (id) on delete restrict,
  date            date not null,
  tonnes          numeric(12,3) not null check (tonnes > 0),
  formula_id      text references public.feed_formulas (id) on delete set null,
  formula_version integer,
  formula_name    text,
  remarks         text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz
);
create index if not exists feed_consumption_company_date_idx on public.feed_consumption (company_id, date);
create index if not exists feed_consumption_shed_idx on public.feed_consumption (shed_id, date);

/** The ingredient split a consumption row took out of the godown, snapshotted row by row. */
create table if not exists public.feed_consumption_deductions (
  consumption_id text not null references public.feed_consumption (id) on delete cascade,
  position       integer not null,
  ingredient     text not null,
  kg             numeric(12,3) not null check (kg >= 0),
  primary key (consumption_id, position)
);

/**
 * Labor's round log: the clock time feed went into the troughs, or that a round was
 * skipped. It carries no quantity by design — stock moves are recorded separately.
 */
create table if not exists public.feed_round_logs (
  id          text primary key,
  company_id  text not null references public.companies (id) on delete cascade,
  batch_id    text not null references public.batches (id) on delete restrict,
  shed_id     text not null references public.sheds (id) on delete restrict,
  date        date not null,
  round       text not null check (round in ('MORNING','AFTERNOON','EVENING')),
  status      text not null check (status in ('GIVEN','SKIPPED')),
  at          time,
  worker_name text,
  remarks     text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz,
  -- A skipped round has no time; a given one must have it. '' becomes NULL on import.
  check ((status = 'GIVEN') = (at is not null)),
  unique (company_id, shed_id, date, round)
);
create index if not exists feed_round_logs_company_date_idx on public.feed_round_logs (company_id, date);

-- ============================= MEDICINES AND VACCINES =============================

create table if not exists public.medicine_items (
  id                  text primary key,
  company_id          text not null references public.companies (id) on delete cascade,
  name                text not null check (length(btrim(name)) > 0),
  category            text not null check (category in ('MEDICINE','VACCINE')),
  -- Stock is counted in the unit it is bought in, never forced into KG.
  unit                text not null check (unit in (
                        'bottle','vial','dose','tablet','sachet','litre','KG','packet','piece')),
  active              boolean not null default true,
  low_stock_threshold numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  specifications      text,
  remarks             text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, name, category)
);
create index if not exists medicine_items_company_idx on public.medicine_items (company_id);

/**
 * The only record of medicine stock, value and movement. `rate_per_unit` and `amount` on a
 * USAGE row are the average that was in force when it was booked, frozen so a later,
 * dearer purchase cannot revalue history.
 */
create table if not exists public.medicine_stock (
  id            text primary key,
  company_id    text not null references public.companies (id) on delete cascade,
  medicine_id   text not null references public.medicine_items (id) on delete restrict,
  date          date not null,
  kind          text not null check (kind in ('OPENING','RECEIPT','USAGE','ADJUSTMENT')),
  qty           numeric(12,3) not null check (qty <> 0),
  rate_per_unit numeric(10,4) check (rate_per_unit is null or rate_per_unit >= 0),
  amount        numeric(14,2) check (amount is null or amount >= 0),
  shed_id       text references public.sheds (id) on delete set null,
  batch_id      text references public.batches (id) on delete set null,
  supplier      text,
  purchase_ref  text,
  lot_number    text,
  expiry_date   date,
  reason        text,
  used_by       text,
  /** Set when completing a vaccination booked this usage, so one dose is never taken twice. */
  vaccination_id text references public.vaccinations (id) on delete set null,
  remarks       text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (company_id, vaccination_id)
);
create index if not exists medicine_stock_company_date_idx on public.medicine_stock (company_id, date);
create index if not exists medicine_stock_item_idx on public.medicine_stock (medicine_id, date);
create unique index if not exists medicine_stock_purchase_ref_uq
  on public.medicine_stock (company_id, purchase_ref) where purchase_ref is not null;

-- ============================= MONEY =============================

/** No outstanding_amount column: a trader's balance is read off the ledger, never stored. */
create table if not exists public.traders (
  id              text primary key,
  company_id      text not null references public.companies (id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  mobile          text not null default '',
  gstin           text,
  address         text,
  opening_balance numeric(14,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists traders_company_idx on public.traders (company_id);

/**
 * The trader statement. ref_id is the voucher that wrote the row; a payment typed straight
 * onto the ledger carries none and stands on its own.
 */
create table if not exists public.trader_txns (
  id              text primary key,
  company_id      text not null references public.companies (id) on delete cascade,
  trader_id       text not null references public.traders (id) on delete cascade,
  date            date not null,
  kind            text not null check (kind in ('OPENING','EGG_SALE','PAYMENT_IN','PAYMENT_OUT','RATE_UPDATE')),
  trays           integer check (trays is null or trays >= 0),
  rate            numeric(10,4) check (rate is null or rate >= 0),
  amount          numeric(14,2) not null default 0,
  ref_id          text references public.sale_entries (id) on delete cascade,
  sale_id         text references public.sale_entries (id) on delete set null,
  payment_method  text check (payment_method is null or payment_method in (
                    'CASH','UPI','PHONEPE','NEFT','RTGS','BANK_TRANSFER','CHEQUE','OTHER')),
  split           jsonb,
  time            time,
  handled_by      uuid references public.profiles (id) on delete set null,
  handed_to       text,
  authorized_by   uuid references public.profiles (id) on delete set null,
  reference       text,
  remarks         text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists trader_txns_company_date_idx on public.trader_txns (company_id, date);
create index if not exists trader_txns_trader_idx on public.trader_txns (trader_id, date);

/** The company ledger. Money for a purchase is entered here, never on the stock row. */
create table if not exists public.finance_txns (
  id              text primary key,
  company_id      text not null references public.companies (id) on delete cascade,
  batch_id        text references public.batches (id) on delete set null,
  /** Set when the row belongs to the godown itself rather than to a shed's P&L. */
  godown          boolean not null default false,
  date            date not null,
  kind            text not null check (kind in ('INCOME','EXPENSE','PURCHASE','SALE','PAYMENT_IN','PAYMENT_OUT')),
  amount          numeric(14,2) not null check (amount >= 0),
  category        text not null check (length(btrim(category)) > 0),
  counterparty    text,
  /** The voucher that generated this row, so editing that voucher replaces exactly its own rows. */
  ref_id          text references public.sale_entries (id) on delete cascade,
  /**
   * The stock receipt this pays for — a godown OR a medicine receipt. It stays plain text
   * because recordPurchasePayment() resolves it against both ledgers (src/store/app.ts);
   * v_purchase_payment resolves it the same way.
   */
  purchase_id     text,
  sale_id         text references public.sale_entries (id) on delete set null,
  payment_method  text check (payment_method is null or payment_method in (
                    'CASH','UPI','PHONEPE','NEFT','RTGS','BANK_TRANSFER','CHEQUE','OTHER')),
  split           jsonb,
  time            time,
  handled_by      uuid references public.profiles (id) on delete set null,
  handed_to       text,
  authorized_by   uuid references public.profiles (id) on delete set null,
  reference       text,
  remarks         text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists finance_txns_company_date_idx on public.finance_txns (company_id, date);
create index if not exists finance_txns_purchase_idx on public.finance_txns (company_id, purchase_id);

/** Cash moved between two of our own people. Moves custody, never money. */
create table if not exists public.cash_handovers (
  id            text primary key,
  company_id    text not null references public.companies (id) on delete cascade,
  date          date not null,
  time          time,
  amount        numeric(14,2) not null check (amount > 0),
  from_user_id  uuid references public.profiles (id) on delete set null,
  to_user_id    uuid references public.profiles (id) on delete set null,
  reason        text,
  reference     text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (from_user_id is null or to_user_id is null or from_user_id <> to_user_id)
);
create index if not exists cash_handovers_company_date_idx on public.cash_handovers (company_id, date);

/**
 * expected_cash and difference ARE columns, unlike every other financial figure: they are a
 * frozen statement about the moment somebody counted, and a later edit must not move them.
 */
create table if not exists public.cash_counts (
  id            text primary key,
  company_id    text not null references public.companies (id) on delete cascade,
  date          date not null,
  physical_cash numeric(14,2) not null check (physical_cash >= 0),
  expected_cash numeric(14,2),
  difference    numeric(14,2) not null default 0,
  closed_by     uuid references public.profiles (id) on delete set null,
  remarks       text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique (company_id, date)
);

-- ============================= CONTROL =============================

/** Who did what. Values stay jsonb: the app logs a field and its before/after, not a schema. */
create table if not exists public.audit (
  id         text primary key,
  company_id text references public.companies (id) on delete cascade,
  entity     text not null,
  entity_id  text not null,
  action     text not null check (action in ('CREATE','UPDATE','DELETE')),
  field      text,
  old_value  jsonb,
  new_value  jsonb,
  reason     text,
  by_user_id uuid references public.profiles (id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists audit_company_at_idx on public.audit (company_id, at desc);
create index if not exists audit_entity_idx on public.audit (entity, entity_id);

create table if not exists public.tasks (
  id                text primary key,
  company_id        text not null references public.companies (id) on delete cascade,
  title             text not null check (length(btrim(title)) > 0),
  date              date not null,
  time              time,
  assigned_user_id  uuid references public.profiles (id) on delete set null,
  farm_id           text references public.farms (id) on delete set null,
  shed_id           text references public.sheds (id) on delete set null,
  batch_id          text references public.batches (id) on delete set null,
  priority          text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status            text not null default 'PENDING' check (status in ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED')),
  remarks           text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tasks_company_date_idx on public.tasks (company_id, date);

/**
 * Per-company, per-day, per-prefix receipt numbering. CR-{date}-NNN is shared by four
 * tables (finance, trader ledger, sale entries, handovers) exactly so two people cannot be
 * handed the same number — which a per-table sequence would guarantee. The strings are
 * load-bearing: migrateSaved() reads PUR-{date}- back off a stored value.
 */
create table if not exists public.receipt_counters (
  company_id text not null references public.companies (id) on delete cascade,
  scope      text not null check (scope in ('CR','PUR','MED')),
  day        date not null,
  next_value integer not null default 1 check (next_value >= 1),
  primary key (company_id, scope, day)
);

-- ============================= DEFERRED KEYS =============================
/*
 * A sale can be made before the trader row is written by the same import, so these two keys
 * are attached after every table exists rather than forcing one domain section to be
 * declared before another. Each block is a no-op on re-run, like the CREATEs above.
 */
do $$ begin
  execute 'alter table public.sale_entries add constraint sale_entries_trader_id_fkey
             foreign key (trader_id) references public.traders (id) on delete restrict';
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  execute 'alter table public.egg_sale_bookings add constraint egg_sale_bookings_trader_id_fkey
             foreign key (trader_id) references public.traders (id) on delete restrict';
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

-- ============================= CONVERGE AN APPLIED SCHEMA =============================
/*
 * Three columns first read as "who, by id" turned out to hold a name somebody typed:
 * vaccinations.completed_by / .cancelled_by and support_messages.handled_by are free text
 * on the client (src/types: completedBy?: string, handledBy set from user.name). A uuid
 * column there loses the answer the farm actually recorded, so they are plain text here.
 * The ALTERs are no-ops on a database created by the current CREATEs above, and the files
 * stay individually re-runnable, so an already-applied schema converges without a dump.
 */
do $$ begin
  alter table public.vaccinations drop constraint vaccinations_completed_by_fkey;
exception when undefined_object or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.vaccinations drop constraint vaccinations_cancelled_by_fkey;
exception when undefined_object or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.support_messages drop constraint support_messages_handled_by_fkey;
exception when undefined_object or invalid_table_definition then null; end $$;

alter table public.vaccinations      alter column completed_by type text using completed_by::text;
alter table public.vaccinations      alter column cancelled_by type text using cancelled_by::text;
alter table public.support_messages  alter column handled_by   type text using handled_by::text;
