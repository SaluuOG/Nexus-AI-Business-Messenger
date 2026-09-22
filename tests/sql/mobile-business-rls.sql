-- Synthetic acceptance only. Every user, conversation and record is rolled back.
BEGIN;
DO $$ DECLARE person text; BEGIN
  FOREACH person IN ARRAY ARRAY['owner','admin','member','guest','outsider','contact','workspace','customer','project'] LOOP
    PERFORM set_config('nexus.mobile.' || person, gen_random_uuid()::text, true);
  END LOOP;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.mobile.'||person)::uuid, current_setting('nexus.mobile.'||person)||'@example.invalid', now(), jsonb_build_object('full_name', 'Mobile Test '||person)
FROM unnest(ARRAY['owner','admin','member','guest','outsider','contact']) person;
INSERT INTO public.workspaces(id,owner_id,name) VALUES (current_setting('nexus.mobile.workspace')::uuid,current_setting('nexus.mobile.owner')::uuid,'Mobile isolated acceptance');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT current_setting('nexus.mobile.workspace')::uuid,current_setting('nexus.mobile.'||person)::uuid,person::public.workspace_role
FROM unnest(ARRAY['admin','member','guest']) person;
INSERT INTO public.contact_links(user_a,user_b)
SELECT least(current_setting('nexus.mobile.'||person),current_setting('nexus.mobile.contact'))::uuid,
       greatest(current_setting('nexus.mobile.'||person),current_setting('nexus.mobile.contact'))::uuid
FROM unnest(ARRAY['owner','member','guest']) person;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mobile.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.customers(id,workspace_id,name,chat_user_id) VALUES (current_setting('nexus.mobile.customer')::uuid,current_setting('nexus.mobile.workspace')::uuid,'Mobile customer',current_setting('nexus.mobile.contact')::uuid);
DO $$ DECLARE saved jsonb; failed_id uuid := gen_random_uuid(); task_count integer; BEGIN
  saved := public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,current_setting('nexus.mobile.project')::uuid,
    jsonb_build_object('title','Atomic project','customer_id',current_setting('nexus.mobile.customer')),
    jsonb_build_array(jsonb_build_object('title','Assigned task','assigned_to',current_setting('nexus.mobile.member'),'due_date',current_date),jsonb_build_object('title','Second task')));
  IF saved->>'id' <> current_setting('nexus.mobile.project') THEN RAISE EXCEPTION 'Project result mismatch'; END IF;
  PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,current_setting('nexus.mobile.project')::uuid,'{"title":"retry must not overwrite"}','[]');
  SELECT count(*) INTO task_count FROM public.project_tasks WHERE project_id=current_setting('nexus.mobile.project')::uuid;
  IF task_count <> 2 OR (SELECT title FROM public.projects WHERE id=current_setting('nexus.mobile.project')::uuid) <> 'Atomic project' THEN RAISE EXCEPTION 'Retry duplicated or overwrote work'; END IF;
  BEGIN
    PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,failed_id,'{"title":"Must roll back"}',
      jsonb_build_array(jsonb_build_object('title','First valid task'),jsonb_build_object('title','Invalid guest assignment','assigned_to',current_setting('nexus.mobile.guest'))));
    RAISE EXCEPTION 'Guest assignment accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Verantwortliche Personen müssen aktive Team-Mitglieder mit Schreibrecht sein.' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.projects WHERE id=failed_id) OR EXISTS(SELECT 1 FROM public.project_tasks WHERE project_id=failed_id) THEN RAISE EXCEPTION 'Partial project remained'; END IF;
  BEGIN
    UPDATE public.customers SET chat_user_id=current_setting('nexus.mobile.outsider')::uuid WHERE id=current_setting('nexus.mobile.customer')::uuid;
    RAISE EXCEPTION 'Unconfirmed contact accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Bitte einen bestätigten Nexus-Kontakt auswählen.' THEN RAISE; END IF;
  END;
  PERFORM public.open_direct_conversation(current_setting('nexus.mobile.contact')::uuid);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mobile.admin'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.customers SET email='admin@example.invalid' WHERE id=current_setting('nexus.mobile.customer')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Admin customer edit denied'; END IF;
  UPDATE public.projects SET title='Admin edited project' WHERE id=current_setting('nexus.mobile.project')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Admin project edit denied'; END IF;
  PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,gen_random_uuid(),' {"title":"Admin project"}','[]');
  BEGIN
    PERFORM public.open_direct_conversation(current_setting('nexus.mobile.contact')::uuid);
    RAISE EXCEPTION 'Customer link bypassed contact privacy';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '1:1-Chats können nur mit Nexus-Kontakten gestartet werden.' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mobile.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.customers SET phone='forbidden' WHERE id=current_setting('nexus.mobile.customer')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Member changed customer'; END IF;
  UPDATE public.projects SET title='forbidden' WHERE id=current_setting('nexus.mobile.project')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Member changed project'; END IF;
  BEGIN
    PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,gen_random_uuid(),'{"title":"Forbidden member project"}','[]');
    RAISE EXCEPTION 'Member created project';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.project_tasks SET status='in_progress' WHERE project_id=current_setting('nexus.mobile.project')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>2 THEN RAISE EXCEPTION 'Member lost task rights'; END IF;
  INSERT INTO public.project_tasks(workspace_id,project_id,title) VALUES(current_setting('nexus.mobile.workspace')::uuid,current_setting('nexus.mobile.project')::uuid,'Member task');
  PERFORM public.open_direct_conversation(current_setting('nexus.mobile.contact')::uuid);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mobile.guest'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
  IF (SELECT count(*) FROM public.project_tasks WHERE project_id=current_setting('nexus.mobile.project')::uuid)<>3 THEN RAISE EXCEPTION 'Guest cannot see project tasks'; END IF;
  UPDATE public.customers SET phone='forbidden' WHERE id=current_setting('nexus.mobile.customer')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Guest changed customer'; END IF;
  UPDATE public.projects SET title='forbidden' WHERE id=current_setting('nexus.mobile.project')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Guest changed project'; END IF;
  UPDATE public.project_tasks SET title='forbidden' WHERE project_id=current_setting('nexus.mobile.project')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Guest changed task'; END IF;
  BEGIN
    PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,gen_random_uuid(),'{"title":"Forbidden guest project"}','[]');
    RAISE EXCEPTION 'Guest created project';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.open_direct_conversation(current_setting('nexus.mobile.contact')::uuid);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mobile.outsider'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.customers WHERE id=current_setting('nexus.mobile.customer')::uuid)
    OR EXISTS(SELECT 1 FROM public.project_tasks WHERE project_id=current_setting('nexus.mobile.project')::uuid) THEN RAISE EXCEPTION 'Cross-workspace disclosure'; END IF;
  BEGIN
    PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,gen_random_uuid(),'{"title":"Forbidden outsider project"}','[]');
    RAISE EXCEPTION 'Outsider created project';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_project_with_tasks(current_setting('nexus.mobile.workspace')::uuid,gen_random_uuid(),'{"title":"Forbidden anonymous project"}','[]');
    RAISE EXCEPTION 'Anonymous caller allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: managers, member/guest restrictions, task rights, customer contact privacy, atomic rollback, retry deduplication, outsider and anonymous isolation' AS acceptance;
