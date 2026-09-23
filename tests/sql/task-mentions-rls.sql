-- Synthetic acceptance for task @mentions. Every change is rolled back.
BEGIN;
SELECT set_config('nexus.mention.owner',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.admin',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.member',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.guest',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.outsider',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.workspace',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.project',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.task',gen_random_uuid()::text,true);
SELECT set_config('nexus.mention.comment',gen_random_uuid()::text,true);

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.mention.'||person)::uuid,current_setting('nexus.mention.'||person)||'@example.invalid',now(),
  jsonb_build_object('full_name',initcap(person)||' Mention Test','role','owner')
FROM unnest(ARRAY['owner','admin','member','guest','outsider']) person;
INSERT INTO public.workspaces(id,owner_id,name) VALUES
  (current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.owner')::uuid,'Mention rollback workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.'||person)::uuid,person::public.workspace_role
FROM unnest(ARRAY['admin','member','guest']) person;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.projects(id,workspace_id,title) VALUES
  (current_setting('nexus.mention.project')::uuid,current_setting('nexus.mention.workspace')::uuid,'Mention rollback project');
WITH inserted AS (
  INSERT INTO public.project_tasks(workspace_id,project_id,title)
  VALUES(current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.project')::uuid,'Mention rollback task') RETURNING id
) SELECT set_config('nexus.mention.task',id::text,true) FROM inserted;

-- Make the member an existing participant. Without the mention exclusion this
-- person would receive both a generic task_comment and a task_mention.
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES (
  current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.task')::uuid,'Prior participant comment'
);
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.task_comments(id,workspace_id,task_id,body,mentioned_user_ids) VALUES (
  current_setting('nexus.mention.comment')::uuid,current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.task')::uuid,
  'Private mention body sentinel',ARRAY[current_setting('nexus.mention.guest')::uuid,current_setting('nexus.mention.member')::uuid,current_setting('nexus.mention.member')::uuid]
);

RESET ROLE;
DO $$
DECLARE ids uuid[];
BEGIN
  SELECT mentioned_user_ids INTO ids FROM public.task_comments WHERE id=current_setting('nexus.mention.comment')::uuid;
  IF ids IS DISTINCT FROM ARRAY[
    least(current_setting('nexus.mention.guest')::uuid,current_setting('nexus.mention.member')::uuid),
    greatest(current_setting('nexus.mention.guest')::uuid,current_setting('nexus.mention.member')::uuid)
  ] THEN RAISE EXCEPTION 'Mention IDs were not normalized: %',ids; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE source_id=current_setting('nexus.mention.comment')::uuid AND kind='task_mention')<>2 THEN
    RAISE EXCEPTION 'Targeted mention notifications missing';
  END IF;
  IF EXISTS(SELECT 1 FROM public.notifications WHERE source_id=current_setting('nexus.mention.comment')::uuid AND kind='task_comment') THEN
    RAISE EXCEPTION 'Mentioned recipients also received generic comment notifications';
  END IF;
  IF EXISTS(SELECT 1 FROM public.notifications WHERE source_id=current_setting('nexus.mention.comment')::uuid AND recipient_id NOT IN
    (current_setting('nexus.mention.member')::uuid,current_setting('nexus.mention.guest')::uuid)) THEN
    RAISE EXCEPTION 'Unselected workspace member received mention';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
UPDATE public.task_comments SET body='Edited private mention body' WHERE id=current_setting('nexus.mention.comment')::uuid;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.notifications WHERE source_id=current_setting('nexus.mention.comment')::uuid)<>2 THEN
    RAISE EXCEPTION 'Editing duplicated mention notifications';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.task_comments SET mentioned_user_ids='{}'::uuid[] WHERE id=current_setting('nexus.mention.comment')::uuid;
    RAISE EXCEPTION 'Mention recipients changed after delivery';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body,mentioned_user_ids) VALUES (
      current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.task')::uuid,'Outsider mention',ARRAY[current_setting('nexus.mention.outsider')::uuid]);
    RAISE EXCEPTION 'Outsider mention accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body,mentioned_user_ids) VALUES (
      current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.task')::uuid,'Self mention',ARRAY[current_setting('nexus.mention.owner')::uuid]);
    RAISE EXCEPTION 'Self mention accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.task_comments(workspace_id,task_id,body,mentioned_user_ids) VALUES (
      current_setting('nexus.mention.workspace')::uuid,current_setting('nexus.mention.task')::uuid,'Too many mentions',array_fill(current_setting('nexus.mention.member')::uuid,ARRAY[21]));
    RAISE EXCEPTION 'Oversized mention request accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE feed jsonb; item jsonb;
BEGIN
  feed:=public.get_my_notifications('UTC');
  IF (feed->>'unread_count')::int<>1 THEN RAISE EXCEPTION 'Member mention feed incorrect: %',feed; END IF;
  item:=feed->'items'->0;
  IF item->>'kind'<>'task_mention' OR item->'details'->>'comment_id'<>current_setting('nexus.mention.comment') OR
    item->'details'->>'workspace_id'<>current_setting('nexus.mention.workspace') OR lower(item::text) LIKE '%private mention body%' THEN
    RAISE EXCEPTION 'Mention details unsafe or incomplete: %',item;
  END IF;
  PERFORM public.set_notification_preference('comments',false);
  IF (public.get_my_notifications('UTC')->>'total_count')::int<>0 THEN RAISE EXCEPTION 'Comment preference did not hide mention'; END IF;
  PERFORM public.set_notification_preference('comments',true);
  IF (public.get_my_notifications('UTC')->>'total_count')::int<>1 THEN RAISE EXCEPTION 'Comment preference did not restore mention'; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.guest'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (public.get_my_notifications('UTC')->>'unread_count')::int<>1 THEN RAISE EXCEPTION 'Mentioned guest cannot open notification'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.task_comments WHERE id=current_setting('nexus.mention.comment')::uuid) THEN RAISE EXCEPTION 'Mentioned guest cannot read comment'; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.admin'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (public.get_my_notifications('UTC')->>'total_count')::int<>0 THEN RAISE EXCEPTION 'Unselected admin received mention'; END IF;
END $$;

RESET ROLE;
DELETE FROM public.workspace_members WHERE workspace_id=current_setting('nexus.mention.workspace')::uuid AND user_id=current_setting('nexus.mention.guest')::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.guest'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notifications) OR (public.get_my_notifications('UTC')->>'total_count')::int<>0 THEN
    RAISE EXCEPTION 'Revoked guest retained mention access';
  END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mention.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM public.task_comments WHERE id=current_setting('nexus.mention.comment')::uuid;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notifications WHERE source_id=current_setting('nexus.mention.comment')::uuid) THEN
    RAISE EXCEPTION 'Deleted comment left mention metadata';
  END IF;
END $$;
ROLLBACK;
SELECT 'task mentions: exact members, guests, preferences, revocation, immutability and cleanup passed; all changes rolled back' AS result;
