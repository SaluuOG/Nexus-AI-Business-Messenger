-- Nexus Phase 2.4 hotfix: allow voice MIME types in the server-side attachment send RPC.
CREATE OR REPLACE FUNCTION public.send_direct_attachment_message(
  p_conversation_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_body text DEFAULT '',
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text;
  v_file_name text;
  v_message_id uuid;
  v_created_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.direct_conversations AS dc WHERE dc.id=p_conversation_id AND (dc.user_a=auth.uid() OR dc.user_b=auth.uid())) THEN RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.'; END IF;
  IF p_storage_path IS NULL OR p_storage_path NOT LIKE p_conversation_id::text || '/' || auth.uid()::text || '/%' THEN RAISE EXCEPTION 'Ungültiger Speicherpfad.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects AS so WHERE so.bucket_id='nexus-chat-attachments' AND so.name=p_storage_path) THEN RAISE EXCEPTION 'Hochgeladene Datei wurde nicht gefunden.'; END IF;
  v_file_name := btrim(coalesce(p_file_name,''));
  IF char_length(v_file_name)<1 OR char_length(v_file_name)>255 THEN RAISE EXCEPTION 'Ungültiger Dateiname.'; END IF;
  IF p_file_size IS NULL OR p_file_size<1 OR p_file_size>26214400 THEN RAISE EXCEPTION 'Datei ist leer oder größer als 25 MB.'; END IF;
  IF p_mime_type IS NULL OR NOT (p_mime_type = ANY (ARRAY[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/pdf','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','application/x-zip-compressed','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'
  ]::text[])) THEN RAISE EXCEPTION 'Dieser Dateityp wird nicht unterstützt.'; END IF;
  v_body := btrim(coalesce(p_body,''));
  IF char_length(v_body)>5000 THEN RAISE EXCEPTION 'Nachricht ist zu lang.'; END IF;
  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.direct_messages AS parent WHERE parent.id=p_reply_to_message_id AND parent.conversation_id=p_conversation_id AND parent.deleted_at IS NULL) THEN RAISE EXCEPTION 'Antwort-Ziel wurde nicht gefunden.'; END IF;
  INSERT INTO public.direct_messages AS dm (conversation_id,sender_id,body,created_at,reply_to_message_id)
  VALUES (p_conversation_id,auth.uid(),v_body,v_created_at,p_reply_to_message_id) RETURNING dm.id INTO v_message_id;
  INSERT INTO public.direct_message_attachments (message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,file_size,created_at)
  VALUES (v_message_id,p_conversation_id,auth.uid(),p_storage_path,v_file_name,p_mime_type,p_file_size,v_created_at);
  UPDATE public.direct_conversations AS dc SET last_message_at=v_created_at,updated_at=v_created_at WHERE dc.id=p_conversation_id;
  RETURN v_message_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_direct_attachment_message(uuid,text,text,text,bigint,text,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_direct_attachment_message(uuid,text,text,text,bigint,text,uuid) TO authenticated;