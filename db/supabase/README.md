# AMRUT · the Postgres side

Everything here is the database the browser store became: the same tables, the same arithmetic,
the same permission answers — enforced where a client cannot talk itself into them.

Nothing in this directory is imported by `src/`. A Vite bundle ships what it imports, and the only
credentials that belong there are the project URL and the anon key.

## Applying it

```
node --env-file=.env db/migrate.mjs --check        # connect, show server + schema, apply nothing
node --env-file=.env db/migrate.mjs                # apply whatever app.schema_migrations lacks
node --env-file=.env db/migrate.mjs --force 004    # re-run one file (every file is idempotent)
```

`POSTGRES_URL_NON_POOLING` is the one that works: the transaction pooler (port 6543) cannot hold a
DDL session, and `CREATE POLICY` / `CREATE VIEW` need one. `SUPABASE_DB_CA` opts the connection
back into certificate verification — without it the driver logs that it is not verifying.

`.env` is gitignored. Whatever key has already been pasted into a chat or a terminal is rotated,
not reused.

| file | what it is |
| --- | --- |
| `000_helpers.sql` | `app.uid() / current_company() / member_of() / role_in() / role_can()`, and `app.role_permissions` — the role matrix as data |
| `001_schema.sql` | the tables: TEXT ids for business rows, uuid only for people, `numeric` for money and kg, TEXT + CHECK instead of enums |
| `002_derived_views.sql` | the 16 read models: stock, valuation, trader balance, sale positions, vaccination state |
| `003_auth_rls.sql` | one company-scoped policy set per table |
| `004_functions.sql` | the write path: RPCs that do exactly what the store's actions do, and refuse in the same words |
| `005_drop_day_lock.sql` | the cleanup for a database already at 000–004: the day-lock concept is gone from the app, so its table, guards and audit verbs come out |

## The rule behind 004

A function is **SECURITY INVOKER** when 003's policies already carry the same gate the store's
action carries — `add_feed_stock`, the three medicine movements, `complete_vaccination`. The caller
either has the right or the write fails on a policy, and the function adds arithmetic only.

It is **SECURITY DEFINER** when the caller's own policies would produce a *wrong answer* rather
than an error. A supervisor may not read `sale_entries` at all, so a plain invoker view of sold
trays would quietly overstate their egg stock; `egg_balance()`, `valuation_at()` and `godown_kg()`
therefore read the money-bearing tables as their owner and return only the counts, kg and averages
the screen already shows. `save_sale_entry()`, `delete_sale_entry()`, `revise_feed_formula()` and
the two payment recorders are definer because the permission they check is not the permission the
caller holds on the row.

The one thing that stays client-side is the per-batch grant: `app.can_on_batch()` widens a role for
a person on a specific flock, and no RLS policy can read a jsonb column per row without turning
every screen into a join. So the grant is checked inside the RPCs, exactly as the app keeps
`useCan()` and `canOnBatch()` as two questions.

## The store, table by table

| persisted slice | becomes |
| --- | --- |
| `companies` | `companies` |
| `users` | `auth.users` + `profiles` + one `company_users` row per `companyIds[]` |
| `farms` `sheds` `batches` `assignments` `mortality` | same-name tables; `batches.closing` → `batch_closings` |
| `feed` | `feed_consumption` + `feed.deduction[]` → `feed_consumption_deductions` |
| `feedRounds` `eggs` `saleLogs` | `feed_round_logs` `egg_collections` `sale_logs` |
| `saleEntries` | `sale_entries`; `lines[]` → `sale_entry_lines`, `rates{}` → `rate_good/broken/double/small` |
| `eggSaleBookings` | `egg_sale_bookings` |
| `feedStock` `medicineItems` `medicineStock` | the two godown ledgers, unchanged |
| `feedFormulas` | `feed_formulas` + `feed_formula_items` (position = order typed) |
| `finance` `traders` `traderTxns` `tasks` | same-name tables |
| `vaccinations` `vaccinationTemplates` | `vaccinations` + `vaccination_templates(_items)` |
| `ingredientCatalog` | `ingredients` (global, no company) |
| `audit` `supportMessages` `cashHandovers` `cashCounts` | same-name tables |
| `session` | nothing — that is Supabase Auth's business |

Deliberately **not** carried across, each for a reason rather than by omission:

- `dayLocks` — the concept was removed from the app (persist v19 drops it from old saves); `005_drop_day_lock.sql` removes it here.
- `synced` — was a sync placeholder for a backend that never existed.
- `traders.outstandingAmount` — a stored cache the derived `v_trader_balance` replaced.
- `saleEntries.credit` — derived from eggs + labour − cash − PhonePe − advance.
- `saleLogs.eggSaleId` — there is no id from a dispatch note to a voucher; accounts match them by
  company, shed, grade and date, and the schema refuses to invent a link.
- `users.passwordHash` — a demo string, never written anywhere. `auth.users` gets a placeholder.
- `disposals` — a slice the current app no longer reads or writes; the import lists it as left behind.

## Importing a browser's data

```
copy(localStorage.getItem('amrut-poultry-v1'))     # from the app's devtools
node --env-file=.env db/import-localstorage.mjs dump.json           # dry run, rolled back
node --env-file=.env db/import-localstorage.mjs dump.json --commit  # write it
```

One transaction, in FK order, upserting on primary key — so a second run over its own work leaves
exactly the same database, which the read-back is there to prove: every slice counted against its
table, child rows counted against the arrays they came from, no negative godown stock, and
`v_egg_stock` equal to collected minus billed.

Person ids are the interesting part: the app's are text (`u_owner`) and the schema's are uuid, so
each one is hashed to a stable uuid and remembered in `profiles.legacy_id`. Re-importing the same
dump lands on the same people.

Writes are issued as each company's Owner because 003's policies admit the widest set of rows to
that role, and an import that re-states a company's own history has to be allowed to write all of
them. A company with no Owner stays anonymous and the policy refusal that follows is the honest
result, not a bypass to code around.

## Proving it

Each layer has a harness that seeds what it needs, checks, and rolls the whole run back:

```
node --env-file=.env db/verify002.mjs      # the derived views against hand-computed numbers
node --env-file=.env db/verify003.mjs      # 33 RLS assertions, one per role per table family
node --env-file=.env db/verify004.mjs      # 133 assertions: every RPC vs the store's own action
node --env-file=.env db/verify-import.mjs  # the real imported farm, read back role by role
```

`verify004` is the one that earns its keep: it runs a scenario several steps deep (receive, receive,
issue, adjust, vaccinate) inside a single rolled-back transaction, and compares the numbers against
what `src/store/app.ts` writes. Where the two disagreed, the store won and 004 was fixed.
