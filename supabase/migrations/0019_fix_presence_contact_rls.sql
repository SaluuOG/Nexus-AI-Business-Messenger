-- Nexus Phase 2.6.1 — keep contact relationships private in Presence RLS
-- Apply after 0018_harden_database_access.sql.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL PRIVILEGES ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- RLS policies run with the querying user's table privileges. This narrow
-- SECURITY DEFINER helper can inspect RPC-only contact_links without granting
-- authenticated users direct access to the relationship table.
CREATE OR REPLACE FUNCTION private.is_contact(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.contact_links AS cl
       WHERE (cl.user_a = (SELECT auth.uid()) AND cl.user_b = p_user_id)
          OR (cl.user_b = (SELECT auth.uid()) AND cl.user_a = p_user_id)
     );
$$;

REVOKE ALL PRIVILEGES ON FUNCTION private.is_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_contact(uuid) TO authenticated;

DROP POLICY IF EXISTS user_presence_select_contacts ON public.user_presence;
CREATE POLICY user_presence_select_contacts
ON public.user_presence FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR private.is_contact(user_id)
);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
