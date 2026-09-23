-- App Store readiness: server-only account deletion planning.
-- The function is deliberately callable only with the service role. The Edge
-- Function validates the caller's JWT before passing the verified identifiers.

CREATE OR REPLACE FUNCTION public.get_account_deletion_plan(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'session_active', EXISTS (
      SELECT 1
      FROM auth.sessions AS session
      WHERE session.id = p_session_id
        AND session.user_id = p_user_id
        AND (session.not_after IS NULL OR session.not_after > now())
    ),
    'owned_workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', workspace.id, 'name', workspace.name) ORDER BY workspace.name)
      FROM public.workspaces AS workspace
      WHERE workspace.owner_id = p_user_id
    ), '[]'::jsonb),
    'owned_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', conversation.id, 'name', conversation.name) ORDER BY conversation.name)
      FROM public.group_members AS member
      JOIN public.group_conversations AS conversation ON conversation.id = member.group_id
      WHERE member.user_id = p_user_id
        AND member.role = 'owner'
    ), '[]'::jsonb),
    'storage_objects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bucket_id', object.bucket_id, 'name', object.name) ORDER BY object.bucket_id, object.name)
      FROM storage.objects AS object
      WHERE object.owner_id = p_user_id::text
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_account_deletion_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_plan(uuid, uuid) TO service_role;

