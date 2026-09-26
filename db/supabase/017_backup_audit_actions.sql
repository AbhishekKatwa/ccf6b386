-- ============================= AMRUT POULTRY · 017 BACKUP VERBS ON THE AUDIT TRAIL =============================
/*
 * Backup & Recovery writes four new steps onto the trail the farm already keeps: a file leaving
 * the company (BACKUP_CREATED) and the three ways an attempt to bring one back can end
 * (RESTORE_STARTED, RESTORE_COMPLETED, RESTORE_FAILED). They are written through the same
 * `auditStep()` shape as every other entry — same table, same authorship, same company scoping —
 * so an export is answered in exactly the place an edit is. src/types/index.ts widens
 * `AuditAction` to carry them, and src/lib/timeline.ts already names each one.
 *
 * The database does not agree yet. 001 wrote the action column with an inline CHECK, and 005
 * re-stated it after the day-lock verbs went away:
 *     audit_action_check  CHECK (action in ('CREATE','UPDATE','DELETE'))
 * so a backup row is refused on the way in — 23514, `23514` — and the entry sits in the device's
 * queue forever. The trail a farm audits itself with must not be the one place the app can write
 * and the database cannot hold.
 *
 * Nothing here changes what any existing row means. The three old verbs keep their exact
 * behaviour; this only opens the door the four new ones already stand at.
 *
 * The check is dropped by what it allows rather than by its name, the way 005 does it: 001 wrote
 * it inline so the catalog chose the name, and a database restored by pg_dump may have chosen
 * another. It is re-added under the name a fresh 001 run gets, so both paths end on one definition.
 */
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.audit'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%CREATE%'
       and pg_get_constraintdef(con.oid) ilike '%UPDATE%'
       and pg_get_constraintdef(con.oid) ilike '%DELETE%'
  loop
    execute format('alter table public.audit drop constraint %I', c.conname);
  end loop;

  alter table public.audit
    add constraint audit_action_check
    check (action in (
      'CREATE', 'UPDATE', 'DELETE',
      'BACKUP_CREATED', 'RESTORE_STARTED', 'RESTORE_COMPLETED', 'RESTORE_FAILED'
    ));
end $$;

-- The company that has already exported and been refused keeps those rows on its device only;
-- once the check accepts them the sync sends them as they are, so there is nothing to backfill.
