-- Phase 3.9: task comments, checklist items and immutable activity metadata.
-- The existing composite task key binds every child to exactly one workspace.
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  FOREIGN KEY (task_id, workspace_id) REFERENCES public.project_tasks(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX task_comments_scope_order_idx ON public.task_comments(workspace_id, task_id, created_at DESC, id DESC);
CREATE INDEX task_comments_author_idx ON public.task_comments(created_by);

CREATE TABLE public.task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 240),
  is_completed boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  FOREIGN KEY (task_id, workspace_id) REFERENCES public.project_tasks(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX task_checklist_scope_idx ON public.task_checklist_items(workspace_id, task_id, id);
CREATE INDEX task_checklist_author_idx ON public.task_checklist_items(created_by);

CREATE TABLE public.task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'task_created','task_updated','comment_created','comment_updated','comment_deleted',
    'checklist_added','checklist_updated','checklist_deleted'
  )),
  changed_fields text[] NOT NULL DEFAULT '{}' CHECK (changed_fields <@ ARRAY[
    'title','description','status','priority','assigned_to','due_date','project_id','label','is_completed'
  ]::text[]),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (task_id, workspace_id) REFERENCES public.project_tasks(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX task_activity_scope_order_idx ON public.task_activity(workspace_id, task_id, created_at DESC, id DESC);
CREATE INDEX task_activity_actor_idx ON public.task_activity(actor_id);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_comments_read ON public.task_comments FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY task_comments_create ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY task_comments_edit_own ON public.task_comments FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]))
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY task_comments_remove ON public.task_comments FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::public.workspace_role[])
    OR (created_by = (SELECT auth.uid()) AND public.has_workspace_role(workspace_id, ARRAY['member']::public.workspace_role[])));

CREATE POLICY task_checklist_read ON public.task_checklist_items FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY task_checklist_create ON public.task_checklist_items FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY task_checklist_edit ON public.task_checklist_items FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY task_checklist_remove ON public.task_checklist_items FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY task_activity_read ON public.task_activity FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Author, scope, clocks and revisions cannot be forged through the public API.
REVOKE ALL ON public.task_comments, public.task_checklist_items, public.task_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.task_comments, public.task_checklist_items TO authenticated;
GRANT SELECT ON public.task_activity TO authenticated;
GRANT INSERT (id, workspace_id, task_id, body) ON public.task_comments TO authenticated;
GRANT UPDATE (body) ON public.task_comments TO authenticated;
GRANT INSERT (id, workspace_id, task_id, label) ON public.task_checklist_items TO authenticated;
GRANT UPDATE (label, is_completed) ON public.task_checklist_items TO authenticated;

CREATE FUNCTION private.guard_task_collaboration()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed boolean;
BEGIN
  IF TG_TABLE_NAME = 'task_comments' THEN
    NEW.body := btrim(NEW.body);
  ELSE
    NEW.label := btrim(NEW.label);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    NEW.revision := 1;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'Task collaboration scope is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'task_comments' THEN
      v_changed := NEW.body IS DISTINCT FROM OLD.body;
    ELSE
      v_changed := NEW.label IS DISTINCT FROM OLD.label OR NEW.is_completed IS DISTINCT FROM OLD.is_completed;
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := CASE WHEN v_changed THEN clock_timestamp() ELSE OLD.updated_at END;
    NEW.revision := OLD.revision + CASE WHEN v_changed THEN 1 ELSE 0 END;
    -- created_by is intentionally not restored: the FK may anonymize a deleted
    -- auth user. Public callers have no UPDATE privilege on that column.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_task_collaboration() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER task_comments_guard BEFORE INSERT OR UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_collaboration();
CREATE TRIGGER task_checklist_guard BEFORE INSERT OR UPDATE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_collaboration();

-- The sole activity writer is a private trigger, not a callable public RPC.
-- SECURITY DEFINER is necessary to write the history table that clients may
-- only read. Store field names only; never archive comment or chat contents.
CREATE FUNCTION private.capture_task_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_workspace uuid;
  v_task uuid;
  v_actor uuid := (SELECT auth.uid());
  v_event text;
  v_fields text[] := '{}';
  v_key text;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_workspace := (v_row->>'workspace_id')::uuid;
  v_task := CASE WHEN TG_TABLE_NAME = 'project_tasks' THEN (v_row->>'id')::uuid ELSE (v_row->>'task_id')::uuid END;
  -- Child DELETE triggers also run during task/project/workspace cascades.
  -- Do not recreate history when its parent has already been removed.
  IF NOT EXISTS (SELECT 1 FROM public.project_tasks WHERE id = v_task AND workspace_id = v_workspace) THEN RETURN NULL; END IF;
  IF v_actor IS NOT NULL AND NOT public.is_workspace_member(v_workspace) THEN v_actor := NULL; END IF;
  IF TG_TABLE_NAME = 'project_tasks' THEN
    IF TG_OP = 'INSERT' THEN v_event := 'task_created';
    ELSE
      v_old := to_jsonb(OLD);
      FOREACH v_key IN ARRAY ARRAY['title','description','status','priority','assigned_to','due_date','project_id'] LOOP
        IF v_row->v_key IS DISTINCT FROM v_old->v_key THEN v_fields := array_append(v_fields, v_key); END IF;
      END LOOP;
      IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
      v_event := 'task_updated';
    END IF;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    v_event := CASE TG_OP WHEN 'INSERT' THEN 'comment_created' WHEN 'DELETE' THEN 'comment_deleted' ELSE 'comment_updated' END;
    IF TG_OP = 'UPDATE' AND NEW.body IS NOT DISTINCT FROM OLD.body THEN RETURN NULL; END IF;
  ELSE
    v_event := CASE TG_OP WHEN 'INSERT' THEN 'checklist_added' WHEN 'DELETE' THEN 'checklist_deleted' ELSE 'checklist_updated' END;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.label IS DISTINCT FROM OLD.label THEN v_fields := array_append(v_fields, 'label'); END IF;
      IF NEW.is_completed IS DISTINCT FROM OLD.is_completed THEN v_fields := array_append(v_fields, 'is_completed'); END IF;
      IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
    END IF;
  END IF;
  INSERT INTO public.task_activity(workspace_id, task_id, actor_id, event_type, changed_fields)
  VALUES (v_workspace, v_task, v_actor, v_event, v_fields);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_task_activity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER project_tasks_activity AFTER INSERT OR UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION private.capture_task_activity();
CREATE TRIGGER task_comments_activity AFTER INSERT OR UPDATE OR DELETE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION private.capture_task_activity();
CREATE TRIGGER task_checklist_activity AFTER INSERT OR UPDATE OR DELETE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION private.capture_task_activity();

ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments, public.task_checklist_items, public.task_activity;
