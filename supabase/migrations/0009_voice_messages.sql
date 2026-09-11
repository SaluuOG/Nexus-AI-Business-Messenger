-- Nexus Phase 2.4 — voice messages
-- Extends the existing private chat attachment architecture with browser-recorded audio.

ALTER TABLE public.direct_message_attachments
  DROP CONSTRAINT IF EXISTS direct_message_attachments_mime_allowed;

ALTER TABLE public.direct_message_attachments
  ADD CONSTRAINT direct_message_attachments_mime_allowed CHECK (
    mime_type = ANY (ARRAY[
      'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
      'application/pdf','text/plain','text/csv',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip','application/x-zip-compressed',
      'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'
    ]::text[])
  );

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
  'application/pdf','text/plain','text/csv',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip','application/x-zip-compressed',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'
]::text[]
WHERE id = 'nexus-chat-attachments';