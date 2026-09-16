-- Run after the Phase 3.9 migration. All users/data are synthetic and rolled back.
BEGIN;
SELECT set_config('nexus.collab.owner', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.admin', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.member', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.guest', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.outsider', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.other', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.project', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.other_project', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.task', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.other_task', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.owner_comment', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.member_comment', gen_random_uuid()::text, true);
SELECT set_config('nexus.collab.check', gen_random_uuid()::text, true);

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.collab.'||person)::uuid,
  current_setting('nexus.collab.'||person)||'@example.invalid', now(),
  jsonb_build_object('full_name',person||' Collaboration','role','owner')
FROM unnest(ARRAY['owner','admin','member','guest','outsider']) person;
INSERT INTO public.workspaces(id,owner_id,name) VALUES
  (current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.owner')::uuid,'Collaboration rollback'),
  (current_setting('nexus.collab.other')::uuid,current_setting('nexus.collab.owner')::uuid,'Other collaboration rollback');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.'||person)::uuid,person::public.workspace_role
FROM unnest(ARRAY['admin','member','guest']) person;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.collab.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.projects(id,workspace_id,title) VALUES
  (current_setting('nexus.collab.project')::uuid,current_setting('nexus.collab.workspace')::uuid,'Test project'),
  (current_setting('nexus.collab.other_project')::uuid,current_setting('nexus.collab.other')::uuid,'Other test project');
-- Existing task INSERT grants intentionally omit id: capture its generated ID.
WITH inserted AS (INSERT INTO public.project_tasks(workspace_id,project_id,title)
  VALUES(current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.project')::uuid,'Collaboration task') RETURNING id)
SELECT set_config('nexus.collab.task',id::text,true) FROM inserted;
WITH inserted AS (INSERT INTO public.project_tasks(workspace_id,project_id,title)
  VALUES(current_setting('nexus.collab.other')::uuid,current_setting('nexus.collab.other_project')::uuid,'Isolated task') RETURNING id)
SELECT set_config('nexus.collab.other_task',id::text,true) FROM inserted;
INSERT INTO public.task_comments(id,workspace_id,task_id,body) VALUES
  (current_setting('nexus.collab.owner_comment')::uuid,current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'  Private-content-sentinel  ');
INSERT INTO public.task_checklist_items(id,workspace_id,task_id,label) VALUES
  (current_setting('nexus.collab.check')::uuid,current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'  Review draft  ');

DO $$
DECLARE c public.task_comments; n integer;
BEGIN
  SELECT * INTO c FROM public.task_comments WHERE id=current_setting('nexus.collab.owner_comment')::uuid;
  IF c.body<>'Private-content-sentinel' OR c.revision<>1 OR c.created_by<>auth.uid() OR c.created_at<>c.updated_at THEN RAISE EXCEPTION 'Comment normalization/audit failed'; END IF;
  IF (SELECT label FROM public.task_checklist_items WHERE id=current_setting('nexus.collab.check')::uuid)<>'Review draft' THEN RAISE EXCEPTION 'Checklist trim failed'; END IF;
  SELECT count(*) INTO n FROM public.task_activity WHERE task_id=c.task_id;
  IF n<>3 THEN RAISE EXCEPTION 'Expected task, comment and checklist events, got %',n; END IF;
  UPDATE public.task_comments SET body='Private-content-sentinel' WHERE id=c.id;
  IF (SELECT revision FROM public.task_comments WHERE id=c.id)<>1 OR (SELECT count(*) FROM public.task_activity WHERE task_id=c.task_id)<>n THEN RAISE EXCEPTION 'No-op edit changed revision/history'; END IF;
  BEGIN
    INSERT INTO public.task_comments(id,workspace_id,task_id,body) VALUES(c.id,c.workspace_id,c.task_id,c.body);
    RAISE EXCEPTION 'Duplicate intent accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.task_activity WHERE task_id=c.task_id)<>n THEN RAISE EXCEPTION 'Duplicate intent added history'; END IF;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(c.workspace_id,current_setting('nexus.collab.other_task')::uuid,'Cross scope');
    RAISE EXCEPTION 'Cross-workspace comment accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.task_checklist_items(workspace_id,task_id,label) VALUES(c.workspace_id,current_setting('nexus.collab.other_task')::uuid,'Cross scope');
    RAISE EXCEPTION 'Cross-workspace checklist accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(c.workspace_id,c.task_id,'  ');
    RAISE EXCEPTION 'Empty comment accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(c.workspace_id,c.task_id,repeat('x',4001));
    RAISE EXCEPTION 'Oversized comment accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.task_checklist_items(workspace_id,task_id,label) VALUES(c.workspace_id,c.task_id,repeat('x',241));
    RAISE EXCEPTION 'Oversized checklist accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.task_comments SET created_by=current_setting('nexus.collab.member')::uuid WHERE id=c.id;
    RAISE EXCEPTION 'Forged author accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.task_checklist_items SET revision=20 WHERE task_id=c.task_id;
    RAISE EXCEPTION 'Forged revision accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.task_comments SET workspace_id=current_setting('nexus.collab.other')::uuid WHERE id=c.id;
    RAISE EXCEPTION 'Scope reassignment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body,created_at) VALUES(c.workspace_id,c.task_id,'Forged',now());
    RAISE EXCEPTION 'Forged timestamp accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.task_activity(workspace_id,task_id,event_type) VALUES(c.workspace_id,c.task_id,'task_created');
    RAISE EXCEPTION 'Forged activity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.task_activity SET event_type='task_updated' WHERE task_id=c.task_id;
    RAISE EXCEPTION 'Activity mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.task_activity WHERE task_id=c.task_id;
    RAISE EXCEPTION 'Activity deletion accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.collab.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.task_comments(id,workspace_id,task_id,body) VALUES
  (current_setting('nexus.collab.member_comment')::uuid,current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'Member comment');
DO $$
DECLARE n integer; c public.task_comments; v_self uuid;
BEGIN
  IF (SELECT count(*) FROM public.task_comments WHERE task_id=current_setting('nexus.collab.task')::uuid)<>2 THEN RAISE EXCEPTION 'Member read failed'; END IF;
  INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'Own removal test') RETURNING id INTO v_self;
  DELETE FROM public.task_comments WHERE id=v_self;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Member cannot remove own comment'; END IF;
  UPDATE public.task_comments SET body='Forbidden' WHERE id=current_setting('nexus.collab.owner_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Member edited another author'; END IF;
  DELETE FROM public.task_comments WHERE id=current_setting('nexus.collab.owner_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Member removed another author'; END IF;
  SELECT * INTO c FROM public.task_comments WHERE id=current_setting('nexus.collab.member_comment')::uuid;
  UPDATE public.task_comments SET body='Member edit' WHERE id=c.id AND revision=c.revision;
  IF (SELECT revision FROM public.task_comments WHERE id=c.id)<>2 THEN RAISE EXCEPTION 'Revision not advanced'; END IF;
  UPDATE public.task_comments SET body='Stale update' WHERE id=c.id AND revision=c.revision;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Stale comment overwritten'; END IF;
  UPDATE public.task_checklist_items SET is_completed=true WHERE id=current_setting('nexus.collab.check')::uuid AND revision=1;
  IF NOT EXISTS (SELECT 1 FROM public.task_checklist_items WHERE id=current_setting('nexus.collab.check')::uuid AND is_completed AND revision=2) THEN RAISE EXCEPTION 'Checklist toggle failed'; END IF;
  DELETE FROM public.task_checklist_items WHERE id=current_setting('nexus.collab.check')::uuid AND revision=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Stale checklist deletion accepted'; END IF;
  UPDATE public.project_tasks SET status='in_progress',priority='high' WHERE id=c.task_id;
  IF NOT EXISTS (SELECT 1 FROM public.task_activity WHERE task_id=c.task_id AND event_type='task_updated' AND changed_fields @> ARRAY['status','priority']) THEN RAISE EXCEPTION 'Task field history missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_activity a WHERE task_id=c.task_id AND to_jsonb(a)::text LIKE '%Private-content-sentinel%') THEN RAISE EXCEPTION 'Content copied to activity'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.other_task')::uuid) THEN RAISE EXCEPTION 'History leaked across workspaces'; END IF;
END $$;

-- Downgrading the author removes their write privilege immediately.
RESET ROLE;
UPDATE public.workspace_members SET role='guest' WHERE workspace_id=current_setting('nexus.collab.workspace')::uuid AND user_id=current_setting('nexus.collab.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.task_comments WHERE id=current_setting('nexus.collab.member_comment')::uuid) OR NOT EXISTS (SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.task')::uuid) THEN RAISE EXCEPTION 'Guest read failed'; END IF;
  UPDATE public.task_comments SET body='Guest write' WHERE id=current_setting('nexus.collab.member_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Guest author edited'; END IF;
  DELETE FROM public.task_comments WHERE id=current_setting('nexus.collab.member_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Guest author deleted'; END IF;
  UPDATE public.task_checklist_items SET is_completed=false WHERE id=current_setting('nexus.collab.check')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Guest changed checklist'; END IF;
  DELETE FROM public.task_checklist_items WHERE id=current_setting('nexus.collab.check')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Guest deleted checklist'; END IF;
  BEGIN
    INSERT INTO public.task_checklist_items(workspace_id,task_id,label) VALUES(current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'Guest checklist');
    RAISE EXCEPTION 'Guest inserted checklist';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(current_setting('nexus.collab.workspace')::uuid,current_setting('nexus.collab.task')::uuid,'Guest insert');
    RAISE EXCEPTION 'Guest inserted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Revocation and user-editable JWT metadata cannot grant access.
RESET ROLE;
DELETE FROM public.workspace_members WHERE workspace_id=current_setting('nexus.collab.workspace')::uuid AND user_id=current_setting('nexus.collab.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.task_comments WHERE task_id=current_setting('nexus.collab.task')::uuid)
    OR EXISTS (SELECT 1 FROM public.task_checklist_items WHERE task_id=current_setting('nexus.collab.task')::uuid)
    OR EXISTS (SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.task')::uuid) THEN RAISE EXCEPTION 'Revoked member retained access'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.collab.outsider'),'role','authenticated','user_metadata',jsonb_build_object('role','owner'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.task_comments) OR EXISTS (SELECT 1 FROM public.task_checklist_items) OR EXISTS (SELECT 1 FROM public.task_activity) THEN RAISE EXCEPTION 'Outsider can read'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.task_comments; RAISE EXCEPTION 'Anon comment read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.task_checklist_items; RAISE EXCEPTION 'Anon checklist read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.task_activity; RAISE EXCEPTION 'Anon activity read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Deleted account attribution is anonymized, without losing shared comments.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DELETE FROM auth.users WHERE id=current_setting('nexus.collab.member')::uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.task_comments WHERE id=current_setting('nexus.collab.member_comment')::uuid AND created_by IS NULL AND body='Member edit') THEN RAISE EXCEPTION 'Account deletion lost comment or attribution'; END IF;
END $$;

-- Admins moderate comments but cannot impersonate their authors by editing.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.collab.admin'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
  UPDATE public.task_comments SET body='Admin impersonation' WHERE id=current_setting('nexus.collab.owner_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Admin edited another author'; END IF;
  DELETE FROM public.task_comments WHERE id=current_setting('nexus.collab.member_comment')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Admin moderation failed'; END IF;
  DELETE FROM public.task_checklist_items WHERE id=current_setting('nexus.collab.check')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Admin checklist removal failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.task')::uuid AND event_type='comment_deleted') OR NOT EXISTS(SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.task')::uuid AND event_type='checklist_deleted') THEN RAISE EXCEPTION 'Deletion history missing'; END IF;
END $$;

-- A project cascade must not reinsert child history or prevent Phase 3.8 deletion.
DELETE FROM public.projects WHERE id=current_setting('nexus.collab.project')::uuid;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.task_comments WHERE task_id=current_setting('nexus.collab.task')::uuid)
    OR EXISTS (SELECT 1 FROM public.task_checklist_items WHERE task_id=current_setting('nexus.collab.task')::uuid)
    OR EXISTS (SELECT 1 FROM public.task_activity WHERE task_id=current_setting('nexus.collab.task')::uuid) THEN RAISE EXCEPTION 'Cascade left collaboration records'; END IF;
  IF has_function_privilege('authenticated','private.capture_task_activity()','EXECUTE') OR has_function_privilege('anon','private.capture_task_activity()','EXECUTE') THEN RAISE EXCEPTION 'Activity writer publicly executable'; END IF;
END $$;
ROLLBACK;
SELECT 'task collaboration: roles, scope, audit, revisions, history, anonymity and cascade passed; all test changes rolled back' AS result;
