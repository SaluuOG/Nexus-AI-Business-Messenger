-- Nexus Phase 3.2 — project tasks, responsibilities and deadlines
-- Apply after 0020_business_management.sql.

CREATE TYPE public.task_status AS ENUM (
  'todo',
  'in_progress',
  'review',
  'blocked',
  'done'
);

ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_workspace_key UNIQUE (id, workspace_id);

CREATE TABLE public.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  title text NOT NULL,
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.project_priority NOT NULL DEFAULT 'medium',
  assigned_to uuid,
  due_date date,
  description text,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_tasks_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id)
    REFERENCES public.projects(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT project_tasks_assignee_workspace_fk
    FOREIGN KEY (workspace_id, assigned_to)
    REFERENCES public.workspace_members(workspace_id, user_id)
    ON DELETE SET NULL (assigned_to),
  CONSTRAINT project_tasks_title_length CHECK (char_length(btrim(title)) BETWEEN 2 AND 180),
  CONSTRAINT project_tasks_description_length CHECK (
    description IS NULL OR char_length(description) <= 4000
  ),
  CONSTRAINT project_tasks_completed_state CHECK (
    (status = 'done' AND completed_at IS NOT NULL)
    OR (status <> 'done' AND completed_at IS NULL)
  )
);

CREATE INDEX project_tasks_workspace_status_idx
  ON public.project_tasks (workspace_id, status, updated_at DESC);
CREATE INDEX project_tasks_workspace_due_idx
  ON public.project_tasks (workspace_id, due_date)
  WHERE due_date IS NOT NULL AND status <> 'done';
CREATE INDEX project_tasks_project_id_idx
  ON public.project_tasks (project_id, workspace_id);
CREATE INDEX project_tasks_assigned_to_idx
  ON public.project_tasks (workspace_id, assigned_to);
CREATE INDEX project_tasks_created_by_idx
  ON public.project_tasks (created_by);

-- Keep tenant/audit columns immutable and validate every project and assignee
-- inside Postgres so the browser cannot move tasks across workspaces.
CREATE FUNCTION public.guard_project_task_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.created_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Der Workspace einer Aufgabe kann nicht geändert werden.';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) AND NOT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Projekt und Aufgabe müssen zum selben Workspace gehören.';
  END IF;

  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_members AS member
    WHERE member.workspace_id = NEW.workspace_id
      AND member.user_id = NEW.assigned_to
      AND member.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'Verantwortliche Personen müssen aktive Team-Mitglieder mit Schreibrecht sein.';
  END IF;

  NEW.title := btrim(NEW.title);
  NEW.description := NULLIF(btrim(NEW.description), '');
  NEW.updated_at := clock_timestamp();

  IF NEW.status = 'done' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.completed_at := NEW.updated_at;
    ELSE
      NEW.completed_at := COALESCE(OLD.completed_at, NEW.updated_at);
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_tasks_guard_scope
BEFORE INSERT OR UPDATE ON public.project_tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_project_task_scope();

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_tasks_select_workspace
ON public.project_tasks FOR SELECT
TO authenticated
USING (public.is_workspace_member(workspace_id));

CREATE POLICY project_tasks_insert_team
ON public.project_tasks FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
);

CREATE POLICY project_tasks_update_team
ON public.project_tasks FOR UPDATE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
)
WITH CHECK (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
);

CREATE POLICY project_tasks_delete_managers
ON public.project_tasks FOR DELETE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin']::public.workspace_role[]
  )
);

GRANT USAGE ON TYPE public.task_status TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.project_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.project_tasks TO authenticated;
GRANT INSERT (workspace_id, project_id, title, status, priority, assigned_to, due_date, description)
  ON public.project_tasks TO authenticated;
GRANT UPDATE (project_id, title, status, priority, assigned_to, due_date, description)
  ON public.project_tasks TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_project_task_scope()
  FROM PUBLIC, anon, authenticated;

-- Role changes run through the existing protected workspace RPCs. Release
-- responsibilities when a teammate becomes a read-only guest. Removal itself
-- is handled atomically by the composite foreign key above.
CREATE FUNCTION private.release_guest_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.project_tasks
  SET assigned_to = NULL
  WHERE workspace_id = NEW.workspace_id AND assigned_to = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION private.release_guest_tasks()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER workspace_member_release_tasks
AFTER UPDATE OF role ON public.workspace_members
FOR EACH ROW WHEN (NEW.role = 'guest' AND OLD.role IS DISTINCT FROM NEW.role)
EXECUTE FUNCTION private.release_guest_tasks();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'project_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_tasks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
  END IF;
END
$$;
