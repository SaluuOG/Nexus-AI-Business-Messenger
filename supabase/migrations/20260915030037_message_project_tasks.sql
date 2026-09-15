-- Phase 3.4: explicit message-to-task sharing. Copied text uses task/workspace
-- permissions; source associations require BOTH workspace and live chat access.
ALTER TABLE public.project_tasks
  ADD CONSTRAINT project_tasks_id_workspace_key UNIQUE (id, workspace_id);

CREATE TABLE public.project_task_sources (
  task_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('direct', 'group')),
  direct_message_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  group_message_id uuid REFERENCES public.group_messages(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT project_task_sources_task_workspace_fk FOREIGN KEY (task_id, workspace_id)
    REFERENCES public.project_tasks(id, workspace_id) ON DELETE CASCADE,
  -- A physical source deletion removes only the link, never the shared task.
  CONSTRAINT project_task_sources_kind_matches CHECK (
    (kind = 'direct' AND group_message_id IS NULL) OR
    (kind = 'group' AND direct_message_id IS NULL)
  )
);
CREATE INDEX project_task_sources_workspace_idx ON public.project_task_sources(workspace_id, task_id);
CREATE INDEX project_task_sources_direct_idx ON public.project_task_sources(direct_message_id);
CREATE INDEX project_task_sources_group_idx ON public.project_task_sources(group_message_id);
CREATE INDEX project_task_sources_creator_idx ON public.project_task_sources(created_by);

ALTER TABLE public.project_task_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_task_sources_read ON public.project_task_sources FOR SELECT TO authenticated
USING (
  public.is_workspace_member(workspace_id)
  AND (
    (kind = 'direct' AND EXISTS (
      SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_id AND m.deleted_at IS NULL
    )) OR
    (kind = 'group' AND EXISTS (
      SELECT 1 FROM public.group_messages m WHERE m.id = group_message_id AND m.deleted_at IS NULL
    ))
  )
);
CREATE POLICY project_task_sources_insert ON public.project_task_sources FOR INSERT TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
  AND EXISTS (
    SELECT 1 FROM public.project_tasks t
    WHERE t.id = task_id AND t.workspace_id = project_task_sources.workspace_id
      AND t.created_by = (SELECT auth.uid())
  )
  AND (
    (kind = 'direct' AND EXISTS (
      SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_id AND m.deleted_at IS NULL
    )) OR
    (kind = 'group' AND EXISTS (
      SELECT 1 FROM public.group_messages m WHERE m.id = group_message_id AND m.deleted_at IS NULL
    ))
  )
);

REVOKE ALL PRIVILEGES ON TABLE public.project_task_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.project_task_sources TO authenticated;
GRANT INSERT (task_id, workspace_id, request_id, kind, direct_message_id, group_message_id)
  ON TABLE public.project_task_sources TO authenticated;

-- Invoker security deliberately preserves the existing RLS, task validation,
-- assignment checks, audit fields and Realtime behaviour. No elevated privileges.
CREATE FUNCTION public.create_task_from_message(
  p_request_id uuid, p_workspace_id uuid, p_project_id uuid, p_kind text,
  p_message_id uuid, p_title text, p_description text DEFAULT NULL,
  p_priority public.project_priority DEFAULT 'medium', p_assigned_to uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source public.project_task_sources;
  v_task public.project_tasks;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_request_id IS NULL OR p_message_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('direct', 'group') THEN
    RAISE EXCEPTION 'Ungültige Nachrichtenquelle.';
  END IF;
  IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]) THEN
    RAISE EXCEPTION 'Du hast in diesem Workspace kein Schreibrecht.';
  END IF;
  IF (p_kind = 'direct' AND NOT EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = p_message_id AND m.deleted_at IS NULL))
    OR (p_kind = 'group' AND NOT EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = p_message_id AND m.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Die Nachricht wurde entfernt oder du hast keinen Zugriff mehr darauf.';
  END IF;

  -- Serialise retries of the same explicit submission, including concurrent
  -- requests. An error rolls back both inserts; a lost response can be retried.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_source FROM public.project_task_sources WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_source.created_by IS DISTINCT FROM (SELECT auth.uid())
      OR v_source.workspace_id IS DISTINCT FROM p_workspace_id
      OR v_source.kind IS DISTINCT FROM p_kind
      OR COALESCE(v_source.direct_message_id, v_source.group_message_id) IS DISTINCT FROM p_message_id THEN
      RAISE EXCEPTION 'Diese Übernahme gehört zu einem anderen Vorgang. Bitte den Dialog erneut öffnen.';
    END IF;
    SELECT * INTO v_task FROM public.project_tasks WHERE id = v_source.task_id;
    RETURN to_jsonb(v_task);
  END IF;

  INSERT INTO public.project_tasks(workspace_id, project_id, title, description, priority, assigned_to, due_date)
  VALUES (p_workspace_id, p_project_id, p_title, p_description, p_priority, p_assigned_to, p_due_date)
  RETURNING * INTO v_task;
  INSERT INTO public.project_task_sources(task_id, workspace_id, request_id, kind, direct_message_id, group_message_id)
  VALUES (v_task.id, p_workspace_id, p_request_id, p_kind,
    CASE WHEN p_kind = 'direct' THEN p_message_id END,
    CASE WHEN p_kind = 'group' THEN p_message_id END);
  RETURN to_jsonb(v_task);
END;
$$;

-- Resolve the exact current message, even outside the chat's recent 200 rows.
-- No stored message text or chat identifiers can bypass the source table's RLS.
CREATE FUNCTION public.get_task_message_source(p_task_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'task_id', s.task_id, 'workspace_id', s.workspace_id, 'kind', s.kind,
    'chat_id', COALESCE(d.conversation_id, g.group_id),
    'message_id', COALESCE(d.id, g.id), 'body', COALESCE(d.body, g.body),
    'created_at', COALESCE(d.created_at, g.created_at),
    'edited_at', COALESCE(d.edited_at, g.edited_at)
  )
  FROM public.project_task_sources s
  LEFT JOIN public.direct_messages d ON d.id = s.direct_message_id
  LEFT JOIN public.group_messages g ON g.id = s.group_message_id
  WHERE s.task_id = p_task_id;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_task_from_message(uuid, uuid, uuid, text, uuid, text, text, public.project_priority, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_task_message_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_from_message(uuid, uuid, uuid, text, uuid, text, text, public.project_priority, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_message_source(uuid) TO authenticated;
