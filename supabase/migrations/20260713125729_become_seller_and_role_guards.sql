-- ============================================================================
-- Authentication phase — role transitions
--
-- This is an ADDITIVE, idempotent migration. Most of what the authentication
-- PRD's Section 3 asks for already ships in the setup-phase migrations, so this
-- file deliberately does NOT recreate those objects — it documents where they
-- live and adds the one genuinely missing piece: become_seller().
--
-- Already provided by 20260710013856_initial_schema.sql:
--   1. profiles.role  -> public.user_role enum ('buyer','seller','admin'),
--                        NOT NULL DEFAULT 'buyer'.  (Section 3.1 — satisfied.)
--   2. handle_new_user() -> SECURITY DEFINER, search_path=public, AFTER INSERT
--        on auth.users; inserts the matching profiles row copying id and pulling
--        full_name/phone from raw_user_meta_data.  (Section 3.2 — satisfied.)
--        NOTE: profiles has no `email` column by design — the address lives in
--        auth.users and is available on the session `user`, so it is not copied.
--
-- Already provided by 20260710015112_rls_policies.sql:
--   3. RLS on profiles (Section 3.3 — satisfied):
--        - profiles_select: readable by everyone (open SELECT).
--        - profiles_update: a user may update only their own row, and the
--          WITH CHECK pins role to its currently-stored value, so a user cannot
--          change their own role directly (self-promotion to 'admin' or
--          'seller' via a plain UPDATE is rejected).
--        - No INSERT policy (rows come from the handle_new_user trigger) and no
--          DELETE policy (deletion cascades from auth.users) — with RLS enabled
--          these commands are denied to client roles.
--
-- This migration adds:
--   4. become_seller() — the ONLY sanctioned buyer -> seller transition
--      (Section 3.4). SECURITY DEFINER so it can write past the role-pinning
--      RLS check above; it upgrades only the caller's own row and only from
--      'buyer', doing nothing for any other current role.
-- ============================================================================

-- become_seller(): upgrade the calling user's own role from 'buyer' to 'seller'.
-- Any other starting role (already 'seller', or 'admin') is a no-op. Returns the
-- caller's resulting role either way, so callers can confirm the outcome.
--
-- SECURITY DEFINER runs as the function owner and bypasses RLS, which is what
-- lets it change `role` despite the profiles_update WITH CHECK. auth.uid() still
-- reads the request's JWT claim inside a SECURITY DEFINER function, so the WHERE
-- clause scopes the write to exactly the caller's row and nothing else.
create or replace function public.become_seller()
returns public.user_role
language plpgsql
security definer
set search_path = public
as $$
declare
  resulting_role public.user_role;
begin
  update public.profiles
     set role = 'seller'
   where id = auth.uid()
     and role = 'buyer'
  returning role into resulting_role;

  -- No row updated: not a buyer (or no profile). Report the current role
  -- unchanged rather than null, so the transition is a clean no-op.
  if resulting_role is null then
    select role into resulting_role
      from public.profiles
     where id = auth.uid();
  end if;

  return resulting_role;
end;
$$;

-- Only signed-in users may call it. Supabase revokes the default PUBLIC execute
-- on new functions; make the intended grant explicit and keep anon out.
revoke all on function public.become_seller() from public, anon;
grant execute on function public.become_seller() to authenticated;
