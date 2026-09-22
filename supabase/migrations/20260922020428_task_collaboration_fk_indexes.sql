-- Match the composite parent FK order while preserving scoped cursor reads.
-- All collaboration reads constrain both task_id and workspace_id, so the
-- trailing order columns still satisfy their pagination without extra indexes.
DROP INDEX public.task_comments_scope_order_idx;
CREATE INDEX task_comments_scope_order_idx
  ON public.task_comments(task_id, workspace_id, created_at DESC, id DESC);
DROP INDEX public.task_checklist_scope_idx;
CREATE INDEX task_checklist_scope_idx
  ON public.task_checklist_items(task_id, workspace_id, id);
DROP INDEX public.task_activity_scope_order_idx;
CREATE INDEX task_activity_scope_order_idx
  ON public.task_activity(task_id, workspace_id, created_at DESC, id DESC);
