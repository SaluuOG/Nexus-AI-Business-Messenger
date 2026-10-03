-- Realtime DELETE events cannot be RLS-filtered. Ordinary removal is an UPDATE,
-- but user/message deletion can still cascade. Expose only a random reaction ID
-- as the replica identity in that case, never the message/user composite key.
ALTER TABLE public.direct_message_reactions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.direct_message_reactions DROP CONSTRAINT direct_message_reactions_pkey;
ALTER TABLE public.direct_message_reactions ADD PRIMARY KEY (id);
ALTER TABLE public.direct_message_reactions ADD CONSTRAINT direct_message_reactions_message_user_key UNIQUE (message_id, user_id);
ALTER TABLE public.direct_message_reactions REPLICA IDENTITY DEFAULT;

ALTER TABLE public.group_message_reactions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.group_message_reactions DROP CONSTRAINT group_message_reactions_pkey;
ALTER TABLE public.group_message_reactions ADD PRIMARY KEY (id);
ALTER TABLE public.group_message_reactions ADD CONSTRAINT group_message_reactions_message_user_key UNIQUE (message_id, user_id);
ALTER TABLE public.group_message_reactions REPLICA IDENTITY DEFAULT;
