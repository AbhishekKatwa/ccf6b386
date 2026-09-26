-- =============================================================================
-- 009 · RESTORE v_egg_stock SECURITY INVOKER + ANON REVOKE
--
-- 006 dropped and recreated public.v_egg_stock to add the wasted column, but
-- it only restored the authenticated SELECT grant. It did not restore the
-- security_invoker flag that 002 set on every view (except v_sale_entry_day),
-- nor the anon revoke that 003 applied to all tables in schema public.
--
-- Without security_invoker, the view runs as its owner (postgres), which
-- bypasses RLS on the underlying tables. Combined with Supabase's default
-- privileges granting ALL to anon on newly created objects, this left
-- v_egg_stock readable by anyone holding the publishable/anon key — a
-- cross-company data exposure of egg stock per shed and grade.
--
-- This file restores exactly what 006 lost. Both statements are idempotent:
-- ALTER VIEW SET is a no-op if already set, and REVOKE from a role that has
-- no privilege is also a no-op.
-- =============================================================================

alter view public.v_egg_stock set (security_invoker = true);

revoke all on public.v_egg_stock from anon;
