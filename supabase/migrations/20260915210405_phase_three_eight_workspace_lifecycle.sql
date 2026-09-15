-- Nexus Phase 3.8 — safe workspace lifecycle and ownership transfer.
-- All destructive or ownership-changing writes are routed through locked,
-- authenticated RPCs. Browser clients retain SELECT/INSERT for workspaces but
-- can no longer bypass the lifecycle checks with direct UPDATE/DELETE calls.

-- No supported write path may create a second owner. This partial index is the
-- final database-level guard against privilege drift or a future RPC mistake.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_one_owner_idx
  ON public.workspace_members (workspace_id)
  WHERE role = 'owner';

CREATE OR REPLACE FUNCTION public.rename_workspace(
  p_workspace_id uuid,
  p_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role public.workspace_role;
  v_name text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  -- Reject unauthorised callers before taking a workspace lock. The role is
  -- checked again after the lock so this optimistic guard cannot create a
  -- time-of-check/time-of-use gap.
  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  -- Every lifecycle mutation locks the workspace first. This gives all four
  -- RPCs one consistent lock order and serializes rename/transfer/leave/delete.
  PERFORM 1
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id
  FOR UPDATE;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  v_name := btrim(COALESCE(p_name, ''));
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Der Workspace-Name muss zwischen 2 und 80 Zeichen lang sein.';
  END IF;

  UPDATE public.workspaces
  SET name = v_name
  WHERE id = p_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_workspace_owner_id uuid;
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
  v_owner_count integer;
  v_rows integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_new_owner_id IS NULL OR p_new_owner_id = v_actor_id THEN
    RAISE EXCEPTION 'Bitte ein anderes aktives Team-Mitglied auswählen.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  JOIN public.workspaces AS workspace
    ON workspace.id = member.workspace_id
   AND workspace.owner_id = v_actor_id
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id;

  IF v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT workspace.owner_id
  INTO v_workspace_owner_id
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  -- Lock memberships in a stable order after the workspace row. Besides the
  -- target, this protects the one-owner invariant from concurrent role writes.
  PERFORM member.user_id
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
  ORDER BY member.user_id
  FOR UPDATE;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id;

  IF v_workspace_owner_id <> v_actor_id OR v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT count(*)::integer
  INTO v_owner_count
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.role = 'owner';

  IF v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Die Workspace-Ownership ist inkonsistent. Übertragung abgebrochen.';
  END IF;

  SELECT member.role
  INTO v_target_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = p_new_owner_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Das ausgewählte Team-Mitglied wurde nicht gefunden.';
  END IF;

  IF v_target_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Ownership kann nur an Admins oder Member übertragen werden.';
  END IF;

  -- The three writes are one database transaction. The owner_id changes first
  -- so protected member mutations can no longer remove/demote the successor.
  UPDATE public.workspaces
  SET owner_id = p_new_owner_id
  WHERE id = p_workspace_id
    AND owner_id = v_actor_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Die Ownership hat sich gleichzeitig geändert. Bitte erneut versuchen.';
  END IF;

  UPDATE public.workspace_members
  SET role = 'admin'
  WHERE workspace_id = p_workspace_id
    AND user_id = v_actor_id
    AND role = 'owner';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Die bisherige Owner-Rolle konnte nicht sicher aktualisiert werden.';
  END IF;

  UPDATE public.workspace_members
  SET role = 'owner'
  WHERE workspace_id = p_workspace_id
    AND user_id = p_new_owner_id
    AND role IN ('admin', 'member');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Die neue Owner-Rolle konnte nicht sicher aktualisiert werden.';
  END IF;

  IF (SELECT count(*) FROM public.workspace_members AS member
      WHERE member.workspace_id = p_workspace_id AND member.role = 'owner') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.workspace_members AS member
       WHERE member.workspace_id = p_workspace_id
         AND member.user_id = p_new_owner_id
         AND member.role = 'owner'
     ) THEN
    RAISE EXCEPTION 'Die Workspace-Ownership konnte nicht eindeutig übertragen werden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_workspace_owner_id uuid;
  v_actor_role public.workspace_role;
  v_rows integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT workspace.owner_id
  INTO v_workspace_owner_id
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id
  FOR UPDATE;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  IF v_workspace_owner_id = v_actor_id OR v_actor_role = 'owner' THEN
    RAISE EXCEPTION 'Der Workspace-Owner muss die Ownership zuerst übertragen.';
  END IF;

  DELETE FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = v_actor_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Der Workspace konnte nicht sicher verlassen werden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_workspace(
  p_workspace_id uuid,
  p_confirmation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_workspace_owner_id uuid;
  v_workspace_name text;
  v_actor_role public.workspace_role;
  v_rows integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  JOIN public.workspaces AS workspace
    ON workspace.id = member.workspace_id
   AND workspace.owner_id = v_actor_id
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id;

  IF v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT workspace.owner_id, workspace.name
  INTO v_workspace_owner_id, v_workspace_name
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT member.role
  INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id = v_actor_id
  FOR UPDATE;

  IF v_workspace_owner_id <> v_actor_id OR v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  IF COALESCE(p_confirmation, '') <> v_workspace_name THEN
    RAISE EXCEPTION 'Der Workspace-Name stimmt nicht überein.';
  END IF;

  DELETE FROM public.workspaces
  WHERE id = p_workspace_id
    AND owner_id = v_actor_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Der Workspace konnte nicht sicher gelöscht werden.';
  END IF;
END;
$$;

-- Existing role/removal RPCs participate in the same workspace-first lock
-- order. This prevents a stale concurrent owner operation from removing or
-- demoting the newly transferred owner after the transfer commits.
CREATE OR REPLACE FUNCTION public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'Die Owner-Rolle kann hier nicht übertragen werden.';
  END IF;

  SELECT member.role INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  PERFORM 1
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  PERFORM member.user_id
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id IN (v_actor_id, p_user_id)
  ORDER BY member.user_id
  FOR UPDATE;

  SELECT member.role INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = v_actor_id;

  SELECT member.role INTO v_target_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Mitglied nicht gefunden.';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Die eigene Rolle kann hier nicht geändert werden.';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Die Owner-Rolle ist geschützt.';
  END IF;

  IF v_actor_role = 'owner' THEN
    UPDATE public.workspace_members
    SET role = p_role
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    RETURN;
  END IF;

  IF v_actor_role = 'admin'
     AND v_target_role IN ('member', 'guest')
     AND p_role IN ('member', 'guest') THEN
    UPDATE public.workspace_members
    SET role = p_role
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Keine Berechtigung für diese Rollenänderung.';
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Du kannst dich in dieser Ansicht nicht selbst entfernen.';
  END IF;

  SELECT member.role INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  PERFORM 1
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace nicht gefunden oder kein Zugriff.';
  END IF;

  PERFORM member.user_id
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id
    AND member.user_id IN (v_actor_id, p_user_id)
  ORDER BY member.user_id
  FOR UPDATE;

  SELECT member.role INTO v_actor_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = v_actor_id;

  SELECT member.role INTO v_target_role
  FROM public.workspace_members AS member
  WHERE member.workspace_id = p_workspace_id AND member.user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Mitglied nicht gefunden.';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Der Workspace-Owner kann nicht entfernt werden.';
  END IF;

  IF v_actor_role = 'owner'
     OR (v_actor_role = 'admin' AND v_target_role IN ('member', 'guest')) THEN
    DELETE FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Keine Berechtigung, dieses Mitglied zu entfernen.';
END;
$$;

REVOKE UPDATE, DELETE ON TABLE public.workspaces FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (id, owner_id, name, slug, avatar_url, created_at, updated_at)
  ON TABLE public.workspaces FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workspace_members
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (workspace_id, user_id, role, joined_at),
  UPDATE (workspace_id, user_id, role, joined_at)
  ON TABLE public.workspace_members FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.rename_workspace(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.transfer_workspace_ownership(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.leave_workspace(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.delete_workspace(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_workspace_member_role(
  uuid, uuid, public.workspace_role
) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.remove_workspace_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rename_workspace(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_workspace_ownership(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_member_role(
  uuid, uuid, public.workspace_role
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid, uuid) TO authenticated;
