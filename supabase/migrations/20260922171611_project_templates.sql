-- Immutable snapshots, managed by workspace Owner/Admin. Client writes are RPC-only.
CREATE TABLE public.project_templates (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 source_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
 source_start date NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 description text CHECK(length(description)<=4000),
 priority public.project_priority NOT NULL,
 deadline_offset integer,
 tasks jsonb NOT NULL CHECK(jsonb_typeof(tasks)='array' AND jsonb_array_length(tasks)<=50),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 archived boolean NOT NULL DEFAULT false
);
CREATE INDEX project_templates_workspace_idx ON public.project_templates(workspace_id,archived,name,id);
CREATE INDEX project_templates_source_idx ON public.project_templates(source_project_id);
CREATE INDEX project_templates_author_idx ON public.project_templates(created_by);
ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_templates FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.project_templates TO authenticated;

-- A JWT must still refer to a live Auth session. Kept private to avoid a public
-- definer endpoint; all operations also check and lock current workspace rights.
CREATE FUNCTION private.project_template_user() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid()); sid uuid:=nullif((SELECT auth.jwt())->>'session_id','')::uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=u AND (not_after IS NULL OR not_after>now())) THEN RETURN u; END IF;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.project_template_user() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.project_template_user() TO authenticated;
CREATE POLICY project_templates_read ON public.project_templates FOR SELECT TO authenticated
 USING(NOT archived AND (SELECT private.project_template_user()) IS NOT NULL
 AND public.has_workspace_role(workspace_id,ARRAY['owner','admin']::public.workspace_role[]));

CREATE FUNCTION private.save_project_template(p_id uuid,p_workspace uuid,p_project uuid,p_name text,p_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=private.project_template_user(); saved public.project_templates; snapshot jsonb; task_count integer; point_count integer;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=u AND role IN('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Keine Berechtigung für Vorlagen.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120 OR p_start IS NULL OR p_start NOT BETWEEN date '1900-01-01' AND date '9999-12-31' THEN
  RAISE EXCEPTION 'Bitte einen Vorlagennamen mit 2 bis 120 Zeichen und ein gültiges Startdatum ab 1900 angeben.' USING ERRCODE='22023'; END IF;
 -- Both workspace capacity and repeated creation intents are serialized.
 PERFORM pg_advisory_xact_lock(hashtextextended('project-template:'||p_workspace,0));
 SELECT * INTO saved FROM public.project_templates WHERE id=p_id;
 IF FOUND THEN
  IF saved.workspace_id<>p_workspace OR saved.created_by IS DISTINCT FROM u THEN RAISE EXCEPTION 'Keine Berechtigung.' USING ERRCODE='42501'; END IF;
  IF saved.archived THEN RAISE EXCEPTION 'Diese Vorlage wurde entfernt. Bitte den Dialog neu öffnen.' USING ERRCODE='22023'; END IF;
  -- The first successful request wins even if its response was lost.
  RETURN to_jsonb(saved);
 END IF;
 IF (SELECT count(*) FROM public.project_templates WHERE workspace_id=p_workspace AND NOT archived)>=100 THEN
  RAISE EXCEPTION 'Maximal 100 Vorlagen pro Workspace. Bitte zuerst eine alte Vorlage entfernen.' USING ERRCODE='22023'; END IF;
 -- One statement captures project, tasks and labels from the same MVCC snapshot.
 -- No customer, assignee, completed status, files, comments or message references.
 SELECT jsonb_build_object('description',p.description,'priority',p.priority,'deadline_offset',p.deadline-p_start,
   'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('title',t.title,'description',t.description,'priority',t.priority,'due_offset',t.due_date-p_start,
     'checklist',COALESCE((SELECT jsonb_agg(c.label ORDER BY c.created_at,c.id) FROM public.task_checklist_items c WHERE c.task_id=t.id AND c.workspace_id=p_workspace),'[]'::jsonb)) ORDER BY t.created_at,t.id)
     FROM public.project_tasks t WHERE t.project_id=p.id AND t.workspace_id=p_workspace),'[]'::jsonb)) INTO snapshot
 FROM public.projects p WHERE p.id=p_project AND p.workspace_id=p_workspace FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ausgangsprojekt nicht verfügbar.' USING ERRCODE='23503'; END IF;
 task_count:=jsonb_array_length(snapshot->'tasks');
 SELECT COALESCE(sum(jsonb_array_length(value->'checklist')),0) INTO point_count FROM jsonb_array_elements(snapshot->'tasks');
 IF task_count>50 OR point_count>500 OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'tasks') WHERE jsonb_array_length(value->'checklist')>100) THEN
  RAISE EXCEPTION 'Eine Vorlage erlaubt höchstens 50 Aufgaben, 100 Checklistenpunkte je Aufgabe und 500 insgesamt.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.project_templates(id,workspace_id,source_project_id,source_start,name,description,priority,deadline_offset,tasks,created_by)
 VALUES(p_id,p_workspace,p_project,p_start,btrim(p_name),snapshot->>'description',(snapshot->>'priority')::public.project_priority,(snapshot->>'deadline_offset')::integer,snapshot->'tasks',u)
 RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
CREATE FUNCTION private.archive_project_template(p_id uuid,p_workspace uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=private.project_template_user();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=u AND role IN('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Keine Berechtigung.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('project-template:'||p_workspace,0));
 -- Retain the intent ID only; retries must never recreate a removed snapshot.
 UPDATE public.project_templates SET archived=true,tasks='[]',description=NULL,source_project_id=NULL,name='Entfernte Vorlage',deadline_offset=NULL
 WHERE id=p_id AND workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION private.save_project_template(uuid,uuid,uuid,text,date),private.archive_project_template(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.save_project_template(uuid,uuid,uuid,text,date),private.archive_project_template(uuid,uuid) TO authenticated;
CREATE FUNCTION public.save_project_template(p_id uuid,p_workspace uuid,p_project uuid,p_name text,p_start date) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_project_template(p_id,p_workspace,p_project,p_name,p_start);$$;
CREATE FUNCTION public.archive_project_template(p_id uuid,p_workspace uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.archive_project_template(p_id,p_workspace);$$;
REVOKE ALL ON FUNCTION public.save_project_template(uuid,uuid,uuid,text,date),public.archive_project_template(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_project_template(uuid,uuid,uuid,text,date),public.archive_project_template(uuid,uuid) TO authenticated;

-- Checklist creation participates in the existing project/task transaction.
CREATE OR REPLACE FUNCTION public.create_project_with_tasks(p_workspace_id uuid, p_project_id uuid, p_project jsonb, p_tasks jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.projects;
  item jsonb;
  new_task_id uuid;
  checklist jsonb;
  label jsonb;
  point_count integer:=0;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]) THEN
    RAISE EXCEPTION 'permission denied: Nur Owner oder Admin können Projekte erstellen.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR p_project IS NULL OR jsonb_typeof(p_project) <> 'object'
    OR p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RAISE EXCEPTION 'Ungültiges Projekt oder Aufgabenpaket.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_tasks) > 50 THEN
    RAISE EXCEPTION 'Beim Anlegen sind höchstens 50 Aufgaben möglich.' USING ERRCODE = '22023';
  END IF;

  -- Serialize retries of the same creation request. The first successful request
  -- wins; a retry returns it and never overwrites the project or duplicates tasks.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text, 0));
  SELECT * INTO saved FROM public.projects WHERE id = p_project_id;
  IF FOUND THEN
    IF saved.workspace_id <> p_workspace_id OR saved.created_by IS DISTINCT FROM (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'permission denied: Projekt-ID bereits vergeben.' USING ERRCODE = '42501';
    END IF;
    RETURN to_jsonb(saved);
  END IF;

  INSERT INTO public.projects(id, workspace_id, customer_id, title, status, priority, value_cents, currency, deadline, progress, description)
  VALUES (p_project_id, p_workspace_id, NULLIF(p_project->>'customer_id', '')::uuid,
    btrim(p_project->>'title'), COALESCE(p_project->>'status', 'planning')::public.project_status,
    COALESCE(p_project->>'priority', 'medium')::public.project_priority,
    COALESCE((p_project->>'value_cents')::bigint, 0), 'EUR', NULLIF(p_project->>'deadline', '')::date,
    COALESCE((p_project->>'progress')::smallint, 0), NULLIF(btrim(p_project->>'description'), ''))
  RETURNING * INTO saved;

  FOR item IN SELECT value FROM jsonb_array_elements(p_tasks) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Ungültige Aufgabe.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.project_tasks(workspace_id, project_id, title, status, priority, assigned_to, due_date, description)
    VALUES (p_workspace_id, saved.id, btrim(item->>'title'), COALESCE(item->>'status', 'todo')::public.task_status,
      COALESCE(item->>'priority', 'medium')::public.project_priority, NULLIF(item->>'assigned_to', '')::uuid,
      NULLIF(item->>'due_date', '')::date, NULLIF(btrim(item->>'description'), '')) RETURNING id INTO new_task_id;
    checklist:=COALESCE(item->'checklist','[]'::jsonb);
    IF jsonb_typeof(checklist)<>'array' THEN RAISE EXCEPTION 'Ungültige Checkliste.' USING ERRCODE='22023'; END IF;
    point_count:=point_count+jsonb_array_length(checklist);
    IF jsonb_array_length(checklist)>100 OR point_count>500 THEN RAISE EXCEPTION 'Zu viele Checklistenpunkte.' USING ERRCODE='22023'; END IF;
    FOR label IN SELECT value FROM jsonb_array_elements(checklist) LOOP
      IF jsonb_typeof(label)<>'string' OR length(btrim(label#>>'{}')) NOT BETWEEN 1 AND 240 THEN
        RAISE EXCEPTION 'Checklistenpunkte müssen 1 bis 240 Zeichen enthalten.' USING ERRCODE='22023'; END IF;
      INSERT INTO public.task_checklist_items(workspace_id,task_id,label) VALUES(p_workspace_id,new_task_id,btrim(label#>>'{}'));
    END LOOP;
  END LOOP;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.create_project_with_tasks(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_with_tasks(uuid, uuid, jsonb, jsonb) TO authenticated;
