-- 008_receipt_allocator.sql — let the browser ask the counter for the next number.
--
-- app.next_receipt_no has existed since 004 and has been granted to the client role all along,
-- but PostgREST only serves functions declared in `public` — which is exactly why 007 puts
-- create_login there. So the counter has never been reachable, and every CR / PUR / MED receipt
-- number is still chosen by scanning one device's own store. Two tablets raising a receipt on
-- the same day for the same company can therefore be handed the same number, and only PUR and
-- MED turn that away (their composite unique indexes); a duplicated CR lands quietly.
--
-- This file adds a door and nothing else. It is SECURITY INVOKER, so the decision stays inside
-- app.next_receipt_no: the series whitelist, the day requirement and the company membership
-- test are unchanged. receipt_counters keeps its columns, its key and its deliberate lack of an
-- RLS policy — no role other than the definer function that owns it can still read or write it.

create or replace function public.next_receipt_no(
  p_company text, p_scope text, p_day date, p_taken integer default null
) returns text
language plpgsql volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  return app.next_receipt_no(p_company, p_scope, p_day, p_taken);
end
$$;

comment on function public.next_receipt_no(text, text, date, integer) is
  'PostgREST-visible door to app.next_receipt_no; all checks live in the function it calls.';

-- The same audience as the function behind it: signed-in users and the import role, never anon.
revoke all on function public.next_receipt_no(text, text, date, integer) from public, anon;
grant execute on function public.next_receipt_no(text, text, date, integer) to authenticated, service_role;

-- The API reads its function list from a cached catalog; without this the door exists but the
-- REST layer keeps answering "schema cache missing an entry" until its next restart.
notify pgrst, 'reload schema';
