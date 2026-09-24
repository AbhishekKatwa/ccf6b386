-- =============================================================================
-- 005 · THE DAY-LOCK CONCEPT COMES OUT
--
-- src/ removed day locking entirely: the panel, the `lockDay`/`unlockDay` permission keys, the
-- LOCK/UNLOCK audit verbs and `isLocked()`, and persist v19 drops `dayLocks` plus the lock trail
-- rows from a save that still carries them. 000–004 as edited now never create any of it, so this
-- file is only the cleanup for a database that was built before the removal. Every step is
-- conditional, so running it on a fresh schema is a no-op.
-- =============================================================================

-- The triggers first: they are the only things that call the guards, and dropping a function an
-- active trigger depends on is refused.
do $$
declare t text;
begin
  foreach t in array array[
      'mortality','egg_collections','feed_consumption','feed_round_logs','sale_logs','tasks',
      'sale_entry_lines'
    ]
  loop
    execute format('drop trigger if exists day_lock_guard on public.%I', t);
  end loop;
end $$;

drop function if exists app.guard_sale_line_lock();
drop function if exists app.guard_day_lock();
drop function if exists app.is_locked(text, date);

-- The locks themselves. Dropping the table takes its index, its policies and its grants with it,
-- which is why none of those are dropped one by one here.
drop table if exists public.day_locks;

-- Who did what: the two verbs only ever recorded a lock or an unlock, so their rows go with the
-- words that described them — exactly what the client's v19 migration does to a stored save.
delete from public.audit where action in ('LOCK','UNLOCK') or entity = 'DayLock';

/*
 * The check is dropped by what it allows rather than by name: 001 wrote it inline, so the catalog
 * chose the name, and a database restored by pg_dump may have chosen another. It is then re-added
 * under the name a fresh 001 run gets, so both paths end on the same definition.
 */
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.audit'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%LOCK%'
  loop
    execute format('alter table public.audit drop constraint %I', c.conname);
  end loop;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.audit'::regclass and conname = 'audit_action_check') then
    alter table public.audit add constraint audit_action_check
      check (action in ('CREATE','UPDATE','DELETE'));
  end if;
end $$;

-- The role matrix as data: these keys no longer exist in src/types, so a role cannot hold them.
delete from app.role_permissions where key in ('lockDay','unlockDay');
