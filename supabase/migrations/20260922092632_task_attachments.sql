-- Task files use their own private bucket. Binary objects are removed through
-- the Storage API by a leased worker; never delete storage.objects with SQL.
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_attachment_scope UNIQUE(id,task_id,workspace_id);
CREATE TABLE public.task_attachments (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 task_id uuid NOT NULL,
 comment_id uuid,
 uploader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 storage_path text NOT NULL UNIQUE,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
 mime_type text NOT NULL,
 file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 26214400),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,workspace_id) REFERENCES public.project_tasks(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(comment_id,task_id,workspace_id) REFERENCES public.task_comments(id,task_id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX task_attachments_task_idx ON public.task_attachments(task_id,workspace_id,created_at,id);
CREATE INDEX task_attachments_comment_idx ON public.task_attachments(comment_id,task_id,workspace_id);
CREATE INDEX task_attachments_uploader_idx ON public.task_attachments(uploader_id);
CREATE INDEX task_attachments_pending_idx ON public.task_attachments(created_at) WHERE state='pending';
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_attachments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.task_attachments TO authenticated;

CREATE TABLE private.task_file_gc (
 id uuid PRIMARY KEY,
 storage_path text NOT NULL UNIQUE,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 finished_at timestamptz
);
CREATE INDEX task_file_gc_due_idx ON private.task_file_gc(next_attempt_at) WHERE finished_at IS NULL;
ALTER TABLE private.task_file_gc ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_file_gc_no_clients ON private.task_file_gc TO authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON private.task_file_gc FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.task_file_wakes(token_hash text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.task_file_wakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_file_wakes_no_clients ON private.task_file_wakes TO authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON private.task_file_wakes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.task_file_user() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid()); sid uuid:=nullif((SELECT auth.jwt())->>'session_id','')::uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=u AND (not_after IS NULL OR not_after>now())) THEN RETURN u; END IF;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.task_file_user() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.task_file_user() TO authenticated;
CREATE POLICY task_attachments_read ON public.task_attachments FOR SELECT TO authenticated
 USING(state='ready' AND (SELECT private.task_file_user()) IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE FUNCTION private.task_file_access(p_path text,p_upload boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_attachments f JOIN public.workspace_members m ON m.workspace_id=f.workspace_id
 WHERE f.storage_path=p_path AND m.user_id=private.task_file_user()
 AND CASE WHEN p_upload THEN f.state='pending' AND f.uploader_id=m.user_id AND m.role<>'guest' AND f.created_at>now()-interval '1 hour'
   AND (f.comment_id IS NULL OR EXISTS(SELECT 1 FROM public.task_comments c WHERE c.id=f.comment_id AND c.created_by=m.user_id))
 ELSE f.state='ready' END);
$$;
REVOKE ALL ON FUNCTION private.task_file_access(text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.task_file_access(text,boolean) TO authenticated;
CREATE POLICY nexus_task_files_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='nexus-task-attachments' AND private.task_file_access(name,true));
CREATE POLICY nexus_task_files_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='nexus-task-attachments' AND private.task_file_access(name,false));
-- No client UPDATE/DELETE policy: objects are immutable and removal is queued.

CREATE FUNCTION private.begin_task_attachment(p_id uuid,p_workspace uuid,p_task uuid,p_comment uuid,p_name text,p_mime text,p_size bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=private.task_file_user(); f public.task_attachments%rowtype; expected_mime text;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=u AND role<>'guest' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Keine Berechtigung für diese Aufgabe.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.project_tasks WHERE id=p_task AND workspace_id=p_workspace FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Aufgabe nicht verfügbar.' USING ERRCODE='23503'; END IF;
 IF p_comment IS NOT NULL THEN
  PERFORM 1 FROM public.task_comments WHERE id=p_comment AND workspace_id=p_workspace AND task_id=p_task AND created_by=u FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dateien können nur an eigene Kommentare angehängt werden.' USING ERRCODE='42501'; END IF;
 END IF;
 expected_mime:=CASE lower(substring(p_name from '[.]([^.]+)$'))
  WHEN 'jpg' THEN 'image/jpeg' WHEN 'jpeg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp'
  WHEN 'gif' THEN 'image/gif' WHEN 'heic' THEN 'image/heic' WHEN 'heif' THEN 'image/heif' WHEN 'pdf' THEN 'application/pdf'
  WHEN 'txt' THEN 'text/plain' WHEN 'csv' THEN 'text/csv' WHEN 'zip' THEN 'application/zip'
  WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation' END;
 IF p_id IS NULL OR p_name IS NULL OR p_name<>btrim(p_name) OR length(p_name) NOT BETWEEN 1 AND 180 OR p_name ~ '[[:cntrl:]/\\]'
 OR expected_mime IS NULL OR p_mime IS DISTINCT FROM expected_mime OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 26214400 THEN
  RAISE EXCEPTION 'Bitte wähle eine unterstützte Datei mit höchstens 25 MB.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-file-user:'||u,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('task-file-task:'||p_task,0));
 SELECT * INTO f FROM public.task_attachments WHERE id=p_id;
 IF FOUND THEN
  IF f.uploader_id IS DISTINCT FROM u OR f.workspace_id<>p_workspace OR f.task_id<>p_task OR f.comment_id IS DISTINCT FROM p_comment
    OR f.file_name<>p_name OR f.mime_type<>p_mime OR f.file_size<>p_size THEN RAISE EXCEPTION 'Upload-Zuordnung stimmt nicht überein.' USING ERRCODE='23514'; END IF;
  RETURN to_jsonb(f);
 END IF;
 IF EXISTS(SELECT 1 FROM private.task_file_gc WHERE id=p_id) THEN RAISE EXCEPTION 'Dieser Upload wurde entfernt. Bitte die Datei neu auswählen.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.task_attachments WHERE task_id=p_task)>=100 THEN RAISE EXCEPTION 'Maximal 100 Dateien pro Aufgabe.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.task_attachments WHERE uploader_id=u AND state='pending')>=10 THEN RAISE EXCEPTION 'Bitte zuerst offene Uploads abschließen oder abbrechen.' USING ERRCODE='23514'; END IF;
 INSERT INTO public.task_attachments(id,workspace_id,task_id,comment_id,uploader_id,storage_path,file_name,mime_type,file_size)
 VALUES(p_id,p_workspace,p_task,p_comment,u,p_workspace||'/'||p_task||'/'||u||'/'||p_id,p_name,p_mime,p_size) RETURNING * INTO f;
 RETURN to_jsonb(f);
END $$;

CREATE FUNCTION private.finish_task_attachment(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=private.task_file_user(); f public.task_attachments%rowtype; meta jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.task_attachments WHERE id=p_id AND uploader_id=u FOR UPDATE;
 IF NOT FOUND OR NOT public.has_workspace_role(f.workspace_id,ARRAY['owner','admin','member']::public.workspace_role[])
 OR (f.comment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.task_comments WHERE id=f.comment_id AND created_by=u)) THEN
  RAISE EXCEPTION 'Aufgabe oder Kommentar ist nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
 IF f.state='ready' THEN RETURN to_jsonb(f); END IF;
 SELECT metadata INTO meta FROM storage.objects WHERE bucket_id='nexus-task-attachments' AND name=f.storage_path;
 IF meta IS NULL OR (meta->>'size')::bigint IS DISTINCT FROM f.file_size OR split_part(meta->>'mimetype',';',1) IS DISTINCT FROM f.mime_type THEN
  RAISE EXCEPTION 'Die Datei wurde noch nicht vollständig hochgeladen. Bitte erneut versuchen.'; END IF;
 UPDATE public.task_attachments SET state='ready' WHERE id=f.id RETURNING * INTO f;
 RETURN to_jsonb(f);
END $$;
CREATE FUNCTION private.remove_task_attachment(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=private.task_file_user(); f public.task_attachments%rowtype;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.task_attachments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT ((f.uploader_id=u AND f.state='pending') OR public.has_workspace_role(f.workspace_id,ARRAY['owner','admin']::public.workspace_role[])
 OR (f.uploader_id=u AND public.has_workspace_role(f.workspace_id,ARRAY['member']::public.workspace_role[]))) THEN
  RAISE EXCEPTION 'Keine Berechtigung zum Entfernen.' USING ERRCODE='42501'; END IF;
 DELETE FROM public.task_attachments WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION private.begin_task_attachment(uuid,uuid,uuid,uuid,text,text,bigint),private.finish_task_attachment(uuid),private.remove_task_attachment(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.begin_task_attachment(uuid,uuid,uuid,uuid,text,text,bigint),private.finish_task_attachment(uuid),private.remove_task_attachment(uuid) TO authenticated;
CREATE FUNCTION public.begin_task_attachment(p_id uuid,p_workspace uuid,p_task uuid,p_comment uuid,p_name text,p_mime text,p_size bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.begin_task_attachment(p_id,p_workspace,p_task,p_comment,p_name,p_mime,p_size);$$;
CREATE FUNCTION public.finish_task_attachment(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.finish_task_attachment(p_id);$$;
CREATE FUNCTION public.remove_task_attachment(p_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.remove_task_attachment(p_id);$$;
REVOKE ALL ON FUNCTION public.begin_task_attachment(uuid,uuid,uuid,uuid,text,text,bigint),public.finish_task_attachment(uuid),public.remove_task_attachment(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.begin_task_attachment(uuid,uuid,uuid,uuid,text,text,bigint),public.finish_task_attachment(uuid),public.remove_task_attachment(uuid) TO authenticated;

CREATE FUNCTION private.task_file_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN INSERT INTO private.task_file_gc(id,storage_path) VALUES(OLD.id,OLD.storage_path) ON CONFLICT DO NOTHING; RETURN NULL; END $$;
REVOKE ALL ON FUNCTION private.task_file_deleted() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER task_file_deleted AFTER DELETE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION private.task_file_deleted();
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_attachments;

CREATE FUNCTION private.wake_task_file_cleanup(p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text;
BEGIN
 DELETE FROM public.task_attachments WHERE state='pending' AND created_at<now()-interval '1 hour';
 DELETE FROM private.task_file_wakes WHERE created_at<now()-interval '2 minutes';
 IF NOT p_force AND NOT EXISTS(SELECT 1 FROM private.task_file_gc WHERE finished_at IS NULL AND next_attempt_at<=now()) THEN RETURN; END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO private.task_file_wakes(token_hash) VALUES(encode(extensions.digest(token,'sha256'),'hex'));
 PERFORM net.http_post(url:='https://mwptfpzhnnkondverggi.supabase.co/functions/v1/task-file-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','x-nexus-cleanup-token',token),body:=jsonb_build_object('initialize',p_force),timeout_milliseconds:=10000);
END $$;
REVOKE ALL ON FUNCTION private.wake_task_file_cleanup(boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.consume_task_file_wake(p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 DELETE FROM private.task_file_wakes WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND created_at>now()-interval '2 minutes';
 RETURN FOUND;
END $$;
CREATE FUNCTION private.claim_task_file_cleanup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 WITH chosen AS(SELECT id FROM private.task_file_gc WHERE finished_at IS NULL AND next_attempt_at<=now() ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 25),
 claimed AS(UPDATE private.task_file_gc g SET lease_token=gen_random_uuid(),attempts=g.attempts+1,next_attempt_at=now()+interval '2 minutes' FROM chosen c WHERE g.id=c.id RETURNING g.id,g.storage_path,g.lease_token)
 SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO result FROM claimed; RETURN result;
END $$;
CREATE FUNCTION private.finish_task_file_cleanup(p_id uuid,p_lease uuid,p_success boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.task_file_gc SET finished_at=CASE WHEN p_success THEN now() ELSE NULL END,lease_token=NULL,
 next_attempt_at=now()+make_interval(secs:=least(3600,30*power(2,least(attempts,7))::integer))
 WHERE id=p_id AND lease_token=p_lease AND finished_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.consume_task_file_wake(text),private.claim_task_file_cleanup(),private.finish_task_file_cleanup(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.consume_task_file_wake(text),private.claim_task_file_cleanup(),private.finish_task_file_cleanup(uuid,uuid,boolean) TO service_role;
CREATE FUNCTION public.consume_task_file_wake(p_token text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.consume_task_file_wake(p_token);$$;
CREATE FUNCTION public.claim_task_file_cleanup() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.claim_task_file_cleanup();$$;
CREATE FUNCTION public.finish_task_file_cleanup(p_id uuid,p_lease uuid,p_success boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.finish_task_file_cleanup(p_id,p_lease,p_success);$$;
REVOKE ALL ON FUNCTION public.consume_task_file_wake(text),public.claim_task_file_cleanup(),public.finish_task_file_cleanup(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_task_file_wake(text),public.claim_task_file_cleanup(),public.finish_task_file_cleanup(uuid,uuid,boolean) TO service_role;
SELECT cron.schedule('nexus-task-file-cleanup','* * * * *','SELECT private.wake_task_file_cleanup();');
