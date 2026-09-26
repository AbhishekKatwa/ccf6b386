-- ============================= AMRUT POULTRY · 016 FEED ROUND CORRECTION =============================
/*
 * A farm labor logs a feed round, then taps the same round again to fix the time. The app
 * accepts that (src/store/app.ts · logFeedRound — "recording it again corrects the time"), and
 * the sync sends it, and the database refuses it: 403 on POST /rest/v1/feed_round_logs. The row
 * stays in the device's queue for good, so the labor's screen shows a feed round that the farm
 * never receives.
 *
 * The refusal is not a bug in the policy so much as a door that was never built. `feed_round_logs`
 * (003) reads:
 *     INSERT  app.role_can(company_id, 'createDailyOps')
 *     UPDATE  app.role_can(company_id, 'update')
 * and the role matrix (000) gives FARM_LABOR and FARM_MANAGER no 'update' key at all. So a
 * labor's first tap lands and their correction of it cannot: the same table, the same kind of
 * fact, one verb open and the other welded shut.
 *
 * This cannot be worked around in the client, because the unique key
 * `feed_round_logs_company_id_shed_id_date_round_key` (001) allows exactly one row per shed,
 * day and round. A second log of a round IS an update of that round — there is no append
 * available. Every other daily-ops sheet (mortality, egg collection) inserts a fresh row each
 * time and so never met this wall.
 *
 * What the new door opens, and why no wider:
 *   · Only `feed_round_logs`. No other table is touched, and no existing policy is edited —
 *     RLS ORs permissive policies, so `company_update` keeps ruling money, flock structure and
 *     everything else exactly as 003 set them.
 *   · Only a caller who already holds `createDailyOps` for the company that owns the row, which
 *     is the same test that table's INSERT policy makes and the same test the client's
 *     dailyOpsGuard() makes. The write verb therefore matches the read verb and the insert verb,
 *     which is the rule this app's sync runs on (see push.ts).
 *   · Only inside their own company: `app.role_can` answers through `app.role_in`, which is
 *     bounded by the caller's `company_users` row, so another company's round is simply not
 *     addressable — naming its id in a request reads nothing and changes nothing.
 *
 * Not done this way on purpose: gating on `created_by = app.uid()` (a person may correct only
 * the rounds they typed). A supervisor pre-loads a shed's rounds and the person on shift then
 * enters the real clock time against that row; a writer-only door would refuse exactly the case
 * the feature exists for, and leave the same stuck queue behind it.
 *
 * The blast radius is one column set with no money and no stock in it: `at`, `status`,
 * `worker_name`, `remarks` and the audit stamps. A feed round records when feed went into the
 * troughs; quantities, deductions and P&L live in `feed_consumption` and `feed_stock`, whose
 * policies are untouched, so a labor still cannot move a single kilogram or rupee.
 */

drop policy if exists feed_round_daily_ops_correction on public.feed_round_logs;

create policy feed_round_daily_ops_correction on public.feed_round_logs
  for update to authenticated
  using      (app.role_can(company_id, 'createDailyOps'))
  with check (app.role_can(company_id, 'createDailyOps'));

comment on policy feed_round_daily_ops_correction on public.feed_round_logs is
  'The round''s clock time is correctable by whoever may log it: 003 gated UPDATE on ''update'', which FARM_LABOR and FARM_MANAGER do not hold, so a labor''s correction of their own round 403''d and stuck in the sync queue. Same predicate as this table''s INSERT policy.';
