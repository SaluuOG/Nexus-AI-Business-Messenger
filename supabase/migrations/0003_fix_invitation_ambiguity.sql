-- Nexus Phase 1B.5 hotfix — fix ambiguous output-column references
-- Run ONCE in Supabase SQL Editor after 0002_workspace_team.sql.
-- No tables or user/workspace data are deleted.

create or replace function public.accept_workspace_invitation(p_token uuid)
returns table (
  workspace_id uuid,
  workspace_name text,
  role public.workspace_role
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invite public.workspace_invitations%rowtype;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;

  select lower(u.email) into v_user_email
  from auth.users as u
  where u.id = auth.uid();

  select wi.* into v_invite
  from public.workspace_invitations as wi
  where wi.token = p_token
  for update;

  if v_invite.id is null then
    raise exception 'Einladung nicht gefunden.';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Diese Einladung wurde widerrufen.';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'Diese Einladung wurde bereits verwendet.';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'Diese Einladung ist abgelaufen.';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Diese Einladung gehört zu einer anderen E-Mail-Adresse.';
  end if;

  insert into public.workspace_members as target_member (workspace_id, user_id, role)
  values (v_invite.workspace_id, auth.uid(), v_invite.role)
  on conflict on constraint workspace_members_pkey do nothing;

  update public.workspace_invitations as target_invitation
  set accepted_at = now(),
      accepted_by = auth.uid()
  where target_invitation.id = v_invite.id;

  return query
  select
    w.id as result_workspace_id,
    w.name as result_workspace_name,
    wm.role as result_role
  from public.workspaces as w
  join public.workspace_members as wm
    on wm.workspace_id = w.id
   and wm.user_id = auth.uid()
  where w.id = v_invite.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invitation(uuid) from public;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;
