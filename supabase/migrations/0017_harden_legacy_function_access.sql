-- Cross-phase security hardening found by the post-Phase-2.5 advisor check.

ALTER FUNCTION public.set_updated_at()
  SET search_path = public;

-- Trigger functions are never client RPC endpoints.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_workspace() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;

-- Workspace RLS uses these helpers for signed-in users. Keep that path while
-- removing the default PUBLIC/anonymous execute privilege.
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_workspace_role(uuid, public.workspace_role[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(uuid, public.workspace_role[]) TO authenticated;
