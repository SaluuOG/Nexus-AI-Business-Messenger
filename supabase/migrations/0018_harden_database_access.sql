-- Nexus Phase 2.6 — least-privilege table access and RLS performance hardening
-- Apply after 0017_harden_legacy_function_access.sql.

-- These tables are intentionally RPC-only. Explicit deny policies document that
-- contract and keep direct Data API access closed even if a grant is added later.
DROP POLICY IF EXISTS contact_links_no_direct_access ON public.contact_links;
CREATE POLICY contact_links_no_direct_access
ON public.contact_links
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS contact_requests_no_direct_access ON public.contact_requests;
CREATE POLICY contact_requests_no_direct_access
ON public.contact_requests
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS workspace_invitations_no_direct_access ON public.workspace_invitations;
CREATE POLICY workspace_invitations_no_direct_access
ON public.workspace_invitations
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Evaluate auth.uid() once per statement instead of once per row.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
ON public.profiles FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
ON public.profiles FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS business_profiles_select_own ON public.business_profiles;
CREATE POLICY business_profiles_select_own
ON public.business_profiles FOR SELECT
TO authenticated
USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS business_profiles_insert_own ON public.business_profiles;
CREATE POLICY business_profiles_insert_own
ON public.business_profiles FOR INSERT
TO authenticated
WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS business_profiles_update_own ON public.business_profiles;
CREATE POLICY business_profiles_update_own
ON public.business_profiles FOR UPDATE
TO authenticated
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS business_profiles_delete_own ON public.business_profiles;
CREATE POLICY business_profiles_delete_own
ON public.business_profiles FOR DELETE
TO authenticated
USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;
CREATE POLICY workspaces_insert_owner
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS direct_conversations_select_participants ON public.direct_conversations;
CREATE POLICY direct_conversations_select_participants
ON public.direct_conversations FOR SELECT
TO authenticated
USING (
  user_a = (SELECT auth.uid())
  OR user_b = (SELECT auth.uid())
);

DROP POLICY IF EXISTS direct_messages_select_participants ON public.direct_messages;
CREATE POLICY direct_messages_select_participants
ON public.direct_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_messages.conversation_id
      AND (
        dc.user_a = (SELECT auth.uid())
        OR dc.user_b = (SELECT auth.uid())
      )
  )
);

DROP POLICY IF EXISTS user_presence_select_contacts ON public.user_presence;
CREATE POLICY user_presence_select_contacts
ON public.user_presence FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.contact_links AS cl
    WHERE (
      cl.user_a = (SELECT auth.uid())
      AND cl.user_b = user_presence.user_id
    ) OR (
      cl.user_b = (SELECT auth.uid())
      AND cl.user_a = user_presence.user_id
    )
  )
);

DROP POLICY IF EXISTS conversation_typing_select_participants ON public.conversation_typing;
CREATE POLICY conversation_typing_select_participants
ON public.conversation_typing FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = conversation_typing.conversation_id
      AND (
        dc.user_a = (SELECT auth.uid())
        OR dc.user_b = (SELECT auth.uid())
      )
  )
);

DROP POLICY IF EXISTS direct_reads_select_participants ON public.direct_conversation_reads;
CREATE POLICY direct_reads_select_participants
ON public.direct_conversation_reads FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_conversation_reads.conversation_id
      AND (
        dc.user_a = (SELECT auth.uid())
        OR dc.user_b = (SELECT auth.uid())
      )
  )
);

DROP POLICY IF EXISTS direct_message_attachments_select_participants ON public.direct_message_attachments;
CREATE POLICY direct_message_attachments_select_participants
ON public.direct_message_attachments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_message_attachments.conversation_id
      AND (
        dc.user_a = (SELECT auth.uid())
        OR dc.user_b = (SELECT auth.uid())
      )
  )
);

-- Foreign-key indexes keep account deletion and membership cleanup predictable.
CREATE INDEX IF NOT EXISTS contact_links_user_b_idx
  ON public.contact_links (user_b);
CREATE INDEX IF NOT EXISTS conversation_typing_user_id_idx
  ON public.conversation_typing (user_id);
CREATE INDEX IF NOT EXISTS direct_conversation_reads_user_id_idx
  ON public.direct_conversation_reads (user_id);
CREATE INDEX IF NOT EXISTS workspace_invitations_accepted_by_idx
  ON public.workspace_invitations (accepted_by);
CREATE INDEX IF NOT EXISTS workspace_invitations_invited_by_idx
  ON public.workspace_invitations (invited_by);
CREATE INDEX IF NOT EXISTS workspaces_owner_id_idx
  ON public.workspaces (owner_id);

-- Reset inherited Supabase table grants, then restore only the operations used by
-- the browser application. SECURITY DEFINER RPCs retain owner-level table access.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspaces TO authenticated;
GRANT SELECT ON TABLE public.workspace_members TO authenticated;

GRANT SELECT ON TABLE
  public.direct_conversations,
  public.direct_messages,
  public.direct_conversation_reads,
  public.user_presence,
  public.conversation_typing
TO authenticated;

GRANT SELECT ON TABLE
  public.group_conversations,
  public.group_members,
  public.group_messages,
  public.group_reads,
  public.group_typing
TO authenticated;

-- Anonymous users must never execute public application functions. The legacy
-- direct-message RPC is no longer used by the client and is closed as well.
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.send_direct_message(uuid, text) FROM authenticated;

-- New public objects start closed and must receive deliberate grants in the same
-- migration that creates them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
