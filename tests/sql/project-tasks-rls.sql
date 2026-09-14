-- Run against Nexus after 0021. Uses two existing user IDs only for identity;
-- creates isolated workspaces and rolls back every test record and role change.
BEGIN;
SELECT set_config('nexus.test.owner', (SELECT user_id::text FROM public.workspace_members WHERE role = 'owner' LIMIT 1), true);
SELECT set_config('nexus.test.member', (SELECT id::text FROM auth.users WHERE id <> current_setting('nexus.test.owner')::uuid ORDER BY created_at LIMIT 1), true);
SELECT set_config('nexus.test.workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.other_workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.project', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.other_project', gen_random_uuid()::text, true);
DO $$ BEGIN
  IF NULLIF(current_setting('nexus.test.owner'), '') IS NULL OR NULLIF(current_setting('nexus.test.member'), '') IS NULL THEN
    RAISE EXCEPTION 'Two existing users are required for this isolated test.';
  END IF;
END $$;

INSERT INTO public.workspaces(id, owner_id, name) VALUES
  (current_setting('nexus.test.workspace')::uuid, current_setting('nexus.test.owner')::uuid, 'Phase 3.2 rollback test'),
  (current_setting('nexus.test.other_workspace')::uuid, current_setting('nexus.test.owner')::uuid, 'Phase 3.2 isolated other workspace');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  (current_setting('nexus.test.workspace')::uuid, current_setting('nexus.test.member')::uuid, 'member');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.projects(id, workspace_id, title) VALUES
  (current_setting('nexus.test.project')::uuid, current_setting('nexus.test.workspace')::uuid, 'Website test'),
  (current_setting('nexus.test.other_project')::uuid, current_setting('nexus.test.other_workspace')::uuid, 'Other website test');

WITH created AS (
  INSERT INTO public.project_tasks(workspace_id, project_id, title, assigned_to, due_date)
  VALUES (current_setting('nexus.test.workspace')::uuid, current_setting('nexus.test.project')::uuid, '  Design Startseite  ', current_setting('nexus.test.member')::uuid, current_date)
  RETURNING id
) SELECT set_config('nexus.test.task', id::text, true) FROM created;

DO $$
DECLARE v_row public.project_tasks; v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.project_tasks WHERE id = current_setting('nexus.test.task')::uuid;
  IF v_row.title <> 'Design Startseite' OR v_row.created_by <> current_setting('nexus.test.owner')::uuid THEN RAISE EXCEPTION 'Owner create/audit failed'; END IF;
  BEGIN
    INSERT INTO public.project_tasks(workspace_id, project_id, title)
    VALUES (current_setting('nexus.test.workspace')::uuid, current_setting('nexus.test.other_project')::uuid, 'Cross workspace');
    RAISE EXCEPTION 'Cross-workspace task was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Projekt und Aufgabe müssen zum selben Workspace gehören.' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.project_tasks SET assigned_to = gen_random_uuid() WHERE id = v_row.id;
    RAISE EXCEPTION 'Nonmember assignment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Verantwortliche Personen müssen aktive Team-Mitglieder mit Schreibrecht sein.' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.project_tasks SET workspace_id = current_setting('nexus.test.other_workspace')::uuid WHERE id = v_row.id;
    RAISE EXCEPTION 'Workspace mutation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.project_tasks SET created_by = current_setting('nexus.test.member')::uuid WHERE id = v_row.id;
    RAISE EXCEPTION 'Creator mutation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.project_tasks(workspace_id, project_id, title, completed_at)
    VALUES (v_row.workspace_id, v_row.project_id, 'Forged completion', now());
    RAISE EXCEPTION 'Completion injection was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.project_tasks(workspace_id, project_id, title)
    VALUES (v_row.workspace_id, v_row.project_id, ' ');
    RAISE EXCEPTION 'Empty title was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_row public.project_tasks; v_completed timestamptz; v_old_updated timestamptz; v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.project_tasks WHERE id = current_setting('nexus.test.task')::uuid;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Member cannot read'; END IF;
  v_old_updated := v_row.updated_at;
  UPDATE public.project_tasks SET status = 'done' WHERE id = v_row.id RETURNING completed_at INTO v_completed;
  IF v_completed IS NULL THEN RAISE EXCEPTION 'Completion timestamp missing'; END IF;
  UPDATE public.project_tasks SET description = 'Member edit' WHERE id = v_row.id;
  IF (SELECT completed_at FROM public.project_tasks WHERE id = v_row.id) <> v_completed THEN RAISE EXCEPTION 'Completion time changed on normal edit'; END IF;
  UPDATE public.project_tasks SET title = 'Stale edit' WHERE id = v_row.id AND updated_at = v_old_updated;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Stale edit was not rejected'; END IF;
  UPDATE public.project_tasks SET status = 'todo' WHERE id = v_row.id;
  IF (SELECT completed_at FROM public.project_tasks WHERE id = v_row.id) IS NOT NULL THEN RAISE EXCEPTION 'Reopened task has completion time'; END IF;
  INSERT INTO public.project_tasks(workspace_id, project_id, title) VALUES (v_row.workspace_id, v_row.project_id, 'Member created task');
  DELETE FROM public.project_tasks WHERE id = v_row.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Member deleted a task'; END IF;
END $$;

-- Guest downgrade releases assignments; all guest writes remain denied.
RESET ROLE;
UPDATE public.workspace_members SET role = 'guest'
WHERE workspace_id = current_setting('nexus.test.workspace')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_row public.project_tasks; v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.project_tasks WHERE id = current_setting('nexus.test.task')::uuid;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Guest cannot read'; END IF;
  IF v_row.assigned_to IS NOT NULL THEN RAISE EXCEPTION 'Guest still assigned'; END IF;
  UPDATE public.project_tasks SET status = 'done' WHERE id = v_row.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Guest edited a task'; END IF;
  DELETE FROM public.project_tasks WHERE id = v_row.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Guest deleted a task'; END IF;
  BEGIN
    INSERT INTO public.project_tasks(workspace_id, project_id, title) VALUES (v_row.workspace_id, v_row.project_id, 'Guest task');
    RAISE EXCEPTION 'Guest inserted a task';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Owner cannot assign to a guest; admin can write and delete.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.project_tasks SET assigned_to = current_setting('nexus.test.member')::uuid WHERE id = current_setting('nexus.test.task')::uuid;
    RAISE EXCEPTION 'Guest assignment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Verantwortliche Personen müssen aktive Team-Mitglieder mit Schreibrecht sein.' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE public.workspace_members SET role = 'admin'
WHERE workspace_id = current_setting('nexus.test.workspace')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_id uuid; v_count integer;
BEGIN
  INSERT INTO public.project_tasks(workspace_id, project_id, title)
  VALUES (current_setting('nexus.test.workspace')::uuid, current_setting('nexus.test.project')::uuid, 'Admin delete test') RETURNING id INTO v_id;
  UPDATE public.project_tasks SET priority = 'urgent' WHERE id = v_id;
  DELETE FROM public.project_tasks WHERE id = v_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Admin delete failed'; END IF;
END $$;

-- Removal releases responsibility without deleting the task.
RESET ROLE;
UPDATE public.project_tasks SET assigned_to = current_setting('nexus.test.member')::uuid WHERE id = current_setting('nexus.test.task')::uuid;
DELETE FROM public.workspace_members WHERE workspace_id = current_setting('nexus.test.workspace')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.project_tasks WHERE id = current_setting('nexus.test.task')::uuid AND assigned_to IS NULL) THEN RAISE EXCEPTION 'Member removal lost task or retained assignment'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.workspace')::uuid) THEN RAISE EXCEPTION 'Removed member can read'; END IF;
END $$;

-- Anonymous access is denied at table grants.
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.project_tasks;
    RAISE EXCEPTION 'Anonymous read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Owner deleting a project cascades its tasks.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DELETE FROM public.projects WHERE id = current_setting('nexus.test.project')::uuid;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.project_tasks WHERE project_id = current_setting('nexus.test.project')::uuid) THEN RAISE EXCEPTION 'Project cascade failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: owner, admin, member, guest, outsider, anonymous, tenant isolation, audit grants, deadlines, completion, concurrent edits, assignment cleanup and project cascade; all test records rolled back.' AS result;
