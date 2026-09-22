-- Customer/project changes are reserved for workspace managers. Task rights stay unchanged.
ALTER POLICY customers_update_team ON public.customers
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]));
ALTER POLICY projects_update_team ON public.projects
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]));

ALTER TABLE public.customers
  ADD COLUMN chat_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX customers_chat_user_id_idx ON public.customers(chat_user_id);

-- A manager explicitly chooses a confirmed contact. No email/name guessing and
-- no new access to private conversations: opening still uses open_direct_conversation.
CREATE FUNCTION public.guard_customer_chat_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.chat_user_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.chat_user_id IS DISTINCT FROM OLD.chat_user_id THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_my_contacts() AS c WHERE c.contact_user_id = NEW.chat_user_id) THEN
        RAISE EXCEPTION 'Bitte einen bestätigten Nexus-Kontakt auswählen.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_customer_chat_contact() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER customers_guard_chat_contact BEFORE INSERT OR UPDATE OF chat_user_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_chat_contact();

CREATE FUNCTION public.create_project_with_tasks(p_workspace_id uuid, p_project_id uuid, p_project jsonb, p_tasks jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.projects;
  item jsonb;
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
      NULLIF(item->>'due_date', '')::date, NULLIF(btrim(item->>'description'), ''));
  END LOOP;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.create_project_with_tasks(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_with_tasks(uuid, uuid, jsonb, jsonb) TO authenticated;
