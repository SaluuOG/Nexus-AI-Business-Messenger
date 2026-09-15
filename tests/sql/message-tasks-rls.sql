-- Isolated Phase 3.4 acceptance. Three existing users supply identities only.
-- Every message, task, fixture and membership change is rolled back.
BEGIN;
SELECT set_config('nexus.test.owner', (SELECT id::text FROM auth.users ORDER BY created_at, id LIMIT 1), true);
SELECT set_config('nexus.test.member', (SELECT id::text FROM auth.users ORDER BY created_at, id OFFSET 1 LIMIT 1), true);
SELECT set_config('nexus.test.outsider', (SELECT id::text FROM auth.users ORDER BY created_at, id OFFSET 2 LIMIT 1), true);
SELECT set_config('nexus.test.ws', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.other_ws', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.project', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.other_project', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.group', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.dm', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.gm', gen_random_uuid()::text, true);
SELECT set_config('nexus.test.request', gen_random_uuid()::text, true);

INSERT INTO public.workspaces(id, owner_id, name) VALUES
  (current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.owner')::uuid, 'Message tasks rollback test'),
  (current_setting('nexus.test.other_ws')::uuid, current_setting('nexus.test.owner')::uuid, 'Other rollback workspace');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  (current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.member')::uuid, 'member'),
  (current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.outsider')::uuid, 'member');
INSERT INTO public.projects(id, workspace_id, title) VALUES
  (current_setting('nexus.test.project')::uuid, current_setting('nexus.test.ws')::uuid, 'Source task project'),
  (current_setting('nexus.test.other_project')::uuid, current_setting('nexus.test.other_ws')::uuid, 'Other project');
INSERT INTO public.direct_conversations(user_a, user_b)
VALUES (LEAST(current_setting('nexus.test.owner')::uuid, current_setting('nexus.test.member')::uuid), GREATEST(current_setting('nexus.test.owner')::uuid, current_setting('nexus.test.member')::uuid))
ON CONFLICT (user_a, user_b) DO NOTHING;
INSERT INTO public.direct_messages(id, conversation_id, sender_id, body, created_at)
SELECT current_setting('nexus.test.dm')::uuid, id, current_setting('nexus.test.owner')::uuid, 'Original direct message!', now() - interval '1 year'
FROM public.direct_conversations WHERE user_a = LEAST(current_setting('nexus.test.owner')::uuid, current_setting('nexus.test.member')::uuid)
  AND user_b = GREATEST(current_setting('nexus.test.owner')::uuid, current_setting('nexus.test.member')::uuid);
INSERT INTO public.group_conversations(id, name, created_by)
VALUES (current_setting('nexus.test.group')::uuid, 'Source rollback group', current_setting('nexus.test.owner')::uuid);
INSERT INTO public.group_members(group_id, user_id, role) VALUES
  (current_setting('nexus.test.group')::uuid, current_setting('nexus.test.owner')::uuid, 'owner'),
  (current_setting('nexus.test.group')::uuid, current_setting('nexus.test.member')::uuid, 'member');
INSERT INTO public.group_messages(id, group_id, sender_id, body, created_at)
VALUES (current_setting('nexus.test.gm')::uuid, current_setting('nexus.test.group')::uuid, current_setting('nexus.test.owner')::uuid, 'Original group message!', now() - interval '1 year');
-- Put the target outside the recent message window.
INSERT INTO public.group_messages(group_id, sender_id, body)
SELECT current_setting('nexus.test.group')::uuid, current_setting('nexus.test.owner')::uuid, 'Recent rollback message ' || n FROM generate_series(1, 201) n;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT set_config('nexus.test.task', public.create_task_from_message(current_setting('nexus.test.request')::uuid, current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'direct', current_setting('nexus.test.dm')::uuid, '  Get it done!  ', 'Shared copy!', 'urgent', current_setting('nexus.test.member')::uuid, current_date)->>'id', true);
DO $$ DECLARE v_retry jsonb; v_count int;
BEGIN
  v_retry := public.create_task_from_message(current_setting('nexus.test.request')::uuid, current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'direct', current_setting('nexus.test.dm')::uuid, 'Retry must not overwrite');
  IF v_retry->>'id' <> current_setting('nexus.test.task') OR v_retry->>'title' <> 'Get it done!' OR v_retry->>'created_by' <> current_setting('nexus.test.owner') THEN RAISE EXCEPTION 'Retry or audit failed'; END IF;
  SELECT count(*) INTO v_count FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.ws')::uuid;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate task'; END IF;
  IF public.get_task_message_source(current_setting('nexus.test.task')::uuid)->>'body' <> 'Original direct message!' THEN RAISE EXCEPTION 'Direct source not resolved'; END IF;
  BEGIN
    PERFORM public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.other_project')::uuid, 'direct', current_setting('nexus.test.dm')::uuid, 'Wrong project');
    RAISE EXCEPTION 'Cross workspace accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Projekt und Aufgabe müssen zum selben Workspace gehören.' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'direct', gen_random_uuid(), 'Forged message');
    RAISE EXCEPTION 'Forged source accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Die Nachricht wurde entfernt oder du hast keinen Zugriff mehr darauf.' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.project_task_sources SET group_message_id = current_setting('nexus.test.gm')::uuid WHERE task_id = current_setting('nexus.test.task')::uuid;
    RAISE EXCEPTION 'Source mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT set_config('nexus.test.group_task', public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'group', current_setting('nexus.test.gm')::uuid, 'Group task', 'Shared group copy')->>'id', true);
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.group_task')::uuid)->>'body' <> 'Original group message!' THEN RAISE EXCEPTION 'Old group source cannot be resolved'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_group_messages(current_setting('nexus.test.group')::uuid, 200) WHERE message_id = current_setting('nexus.test.gm')::uuid) THEN RAISE EXCEPTION 'History fixture did not exceed recent limit'; END IF;
END $$;

-- Workspace colleague can see the deliberately copied task, but not either chat.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.outsider'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.ws')::uuid) <> 2 THEN RAISE EXCEPTION 'Shared tasks missing for colleague'; END IF;
  IF EXISTS (SELECT 1 FROM public.project_task_sources WHERE workspace_id = current_setting('nexus.test.ws')::uuid) THEN RAISE EXCEPTION 'Private source metadata leaked'; END IF;
  IF public.get_task_message_source(current_setting('nexus.test.task')::uuid) IS NOT NULL OR public.get_task_message_source(current_setting('nexus.test.group_task')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Private source leaked'; END IF;
  BEGIN
    PERFORM public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'group', current_setting('nexus.test.gm')::uuid, 'Private group task');
    RAISE EXCEPTION 'Outsider converted private message';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Die Nachricht wurde entfernt oder du hast keinen Zugriff mehr darauf.' THEN RAISE; END IF; END;
END $$;

-- Guests can read an accessible source, but cannot create or be assigned tasks.
RESET ROLE;
UPDATE public.workspace_members SET role = 'guest' WHERE workspace_id = current_setting('nexus.test.ws')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.group_task')::uuid) IS NULL THEN RAISE EXCEPTION 'Guest lost legitimate read access'; END IF;
  BEGIN
    PERFORM public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'direct', current_setting('nexus.test.dm')::uuid, 'Guest task');
    RAISE EXCEPTION 'Guest wrote task';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Du hast in diesem Workspace kein Schreibrecht.' THEN RAISE; END IF; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_task_from_message(gen_random_uuid(), current_setting('nexus.test.ws')::uuid, current_setting('nexus.test.project')::uuid, 'direct', current_setting('nexus.test.dm')::uuid, 'Bad assignment', NULL, 'medium', current_setting('nexus.test.member')::uuid);
    RAISE EXCEPTION 'Guest assignment accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Verantwortliche Personen müssen aktive Team-Mitglieder mit Schreibrecht sein.' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.ws')::uuid) <> 2 THEN RAISE EXCEPTION 'Failed RPC left orphan task'; END IF;
END $$;

-- Edits change the live source, never the deliberately shared task copy.
RESET ROLE;
UPDATE public.direct_messages SET body = 'Edited original!' WHERE id = current_setting('nexus.test.dm')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.task')::uuid)->>'body' <> 'Edited original!' THEN RAISE EXCEPTION 'Source snapshot is stale'; END IF;
  IF (SELECT description FROM public.project_tasks WHERE id = current_setting('nexus.test.task')::uuid) <> 'Shared copy!' THEN RAISE EXCEPTION 'Task copy changed'; END IF;
END $$;

-- Loss of chat membership and then workspace membership closes source access.
RESET ROLE;
DELETE FROM public.group_members WHERE group_id = current_setting('nexus.test.group')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.group_task')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Former group member reads source'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_tasks WHERE id = current_setting('nexus.test.group_task')::uuid) THEN RAISE EXCEPTION 'Group removal deleted shared task'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.workspace_members WHERE workspace_id = current_setting('nexus.test.ws')::uuid AND user_id = current_setting('nexus.test.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.task')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Former workspace member reads association'; END IF;
END $$;

-- Deleted messages and groups preserve tasks and remove readable associations.
RESET ROLE;
UPDATE public.direct_messages SET deleted_at = now(), body = '' WHERE id = current_setting('nexus.test.dm')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('nexus.test.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_task_message_source(current_setting('nexus.test.task')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Soft deleted source readable'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.direct_messages WHERE id = current_setting('nexus.test.dm')::uuid;
DELETE FROM public.group_conversations WHERE id = current_setting('nexus.test.group')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.ws')::uuid) <> 2 THEN RAISE EXCEPTION 'Source deletion removed task'; END IF;
  IF EXISTS (SELECT 1 FROM public.project_task_sources WHERE workspace_id = current_setting('nexus.test.ws')::uuid) THEN RAISE EXCEPTION 'Deleted source metadata readable'; END IF;
  DELETE FROM public.project_tasks WHERE workspace_id = current_setting('nexus.test.ws')::uuid;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.project_task_sources WHERE workspace_id = current_setting('nexus.test.ws')::uuid) THEN RAISE EXCEPTION 'Task delete left association'; END IF;
  IF has_table_privilege('anon', 'public.project_task_sources', 'SELECT') OR has_function_privilege('anon', 'public.get_task_message_source(uuid)', 'EXECUTE') OR has_function_privilege('anon', 'public.create_task_from_message(uuid,uuid,uuid,text,uuid,text,text,public.project_priority,uuid,date)', 'EXECUTE') THEN RAISE EXCEPTION 'Anonymous access allowed'; END IF;
END $$;
ROLLBACK;
