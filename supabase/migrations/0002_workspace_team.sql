-- Nexus Phase 1B.5 — workspace invitations, member directory and secure role management
-- Run this migration ONCE in the Supabase SQL Editor after 0001_nexus_core.sql.

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint workspace_invitations_no_owner check (role <> 'owner')
);

create unique index if not exists workspace_invitations_pending_email_idx
on public.workspace_invitations (workspace_id, lower(email))
where accepted_at is null and revoked_at is null;

create index if not exists workspace_invitations_workspace_idx
on public.workspace_invitations (workspace_id, created_at desc);

create index if not exists workspace_invitations_token_idx
on public.workspace_invitations (token);

alter table public.workspace_invitations enable row level security;

-- Team writes are routed through security-definer RPC functions below. This
-- prevents an Admin from changing/removing an Owner by talking to the table
-- directly and keeps invitation tokens hidden from normal table queries.
drop policy if exists "workspace_members_insert_admin" on public.workspace_members;
drop policy if exists "workspace_members_update_admin" on public.workspace_members;
drop policy if exists "workspace_members_delete_admin" on public.workspace_members;

revoke insert, update, delete on public.workspace_members from authenticated;
revoke all on public.workspace_invitations from anon, authenticated;

create or replace function public.get_workspace_members(p_workspace_id uuid)
returns table (
  user_id uuid,
  role public.workspace_role,
  joined_at timestamptz,
  full_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Kein Zugriff auf diesen Workspace.';
  end if;

  return query
  select
    wm.user_id,
    wm.role,
    wm.joined_at,
    p.full_name,
    p.username,
    p.avatar_url
  from public.workspace_members wm
  left join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = p_workspace_id
  order by
    case wm.role
      when 'owner' then 1
      when 'admin' then 2
      when 'member' then 3
      else 4
    end,
    wm.joined_at asc;
end;
$$;

create or replace function public.get_workspace_invitations(p_workspace_id uuid)
returns table (
  id uuid,
  workspace_id uuid,
  email text,
  role public.workspace_role,
  token uuid,
  invited_by uuid,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.workspace_role;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select wm.role into v_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Nur Owner und Admins dürfen Einladungen sehen.';
  end if;

  return query
  select
    wi.id,
    wi.workspace_id,
    wi.email,
    wi.role,
    wi.token,
    wi.invited_by,
    wi.created_at,
    wi.expires_at
  from public.workspace_invitations wi
  where wi.workspace_id = p_workspace_id
    and wi.accepted_at is null
    and wi.revoked_at is null
  order by wi.created_at desc;
end;
$$;

create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role default 'member'
)
returns table (
  id uuid,
  workspace_id uuid,
  email text,
  role public.workspace_role,
  token uuid,
  invited_by uuid,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inviter_role public.workspace_role;
  v_email text;
  v_self_email text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select wm.role into v_inviter_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid();

  if v_inviter_role is null or v_inviter_role not in ('owner', 'admin') then
    raise exception 'Nur Owner und Admins dürfen Mitglieder einladen.';
  end if;

  if p_role = 'owner' then
    raise exception 'Die Owner-Rolle kann nicht per Einladung vergeben werden.';
  end if;

  if v_inviter_role = 'admin' and p_role not in ('member', 'guest') then
    raise exception 'Admins dürfen nur Member oder Guests einladen.';
  end if;

  v_email := lower(trim(p_email));
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Bitte eine gültige E-Mail-Adresse eingeben.';
  end if;

  select lower(u.email) into v_self_email
  from auth.users u
  where u.id = auth.uid();

  if v_email = v_self_email then
    raise exception 'Du bist bereits Mitglied dieses Workspaces.';
  end if;

  if exists (
    select 1
    from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    where wm.workspace_id = p_workspace_id
      and lower(u.email) = v_email
  ) then
    raise exception 'Dieser Nexus-Account ist bereits Mitglied.';
  end if;

  -- Reissuing an invitation invalidates older active links for the same email.
  update public.workspace_invitations wi
  set revoked_at = now()
  where wi.workspace_id = p_workspace_id
    and lower(wi.email) = v_email
    and wi.accepted_at is null
    and wi.revoked_at is null;

  return query
  insert into public.workspace_invitations (
    workspace_id,
    email,
    role,
    invited_by
  )
  values (
    p_workspace_id,
    v_email,
    p_role,
    auth.uid()
  )
  returning
    workspace_invitations.id,
    workspace_invitations.workspace_id,
    workspace_invitations.email,
    workspace_invitations.role,
    workspace_invitations.token,
    workspace_invitations.invited_by,
    workspace_invitations.created_at,
    workspace_invitations.expires_at;
end;
$$;

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
  from auth.users u
  where u.id = auth.uid();

  select wi.* into v_invite
  from public.workspace_invitations wi
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

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, auth.uid(), v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = now(),
      accepted_by = auth.uid()
  where id = v_invite.id;

  return query
  select w.id, w.name, wm.role
  from public.workspaces w
  join public.workspace_members wm
    on wm.workspace_id = w.id
   and wm.user_id = auth.uid()
  where w.id = v_invite.workspace_id;
end;
$$;

create or replace function public.revoke_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.workspace_invitations%rowtype;
  v_actor_role public.workspace_role;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select wi.* into v_invite
  from public.workspace_invitations wi
  where wi.id = p_invitation_id;

  if v_invite.id is null then
    raise exception 'Einladung nicht gefunden.';
  end if;

  select wm.role into v_actor_role
  from public.workspace_members wm
  where wm.workspace_id = v_invite.workspace_id
    and wm.user_id = auth.uid();

  if v_actor_role = 'owner' then
    null;
  elsif v_actor_role = 'admin' and v_invite.role in ('member', 'guest') then
    null;
  else
    raise exception 'Keine Berechtigung, diese Einladung zu widerrufen.';
  end if;

  update public.workspace_invitations
  set revoked_at = now()
  where id = p_invitation_id
    and accepted_at is null
    and revoked_at is null;
end;
$$;

create or replace function public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if p_role = 'owner' then
    raise exception 'Die Owner-Rolle kann hier nicht übertragen werden.';
  end if;

  select wm.role into v_actor_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid();

  select wm.role into v_target_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Mitglied nicht gefunden.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Die eigene Rolle kann hier nicht geändert werden.';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Die Owner-Rolle ist geschützt.';
  end if;

  if v_actor_role = 'owner' then
    update public.workspace_members
    set role = p_role
    where workspace_id = p_workspace_id
      and user_id = p_user_id;
    return;
  end if;

  if v_actor_role = 'admin'
     and v_target_role in ('member', 'guest')
     and p_role in ('member', 'guest') then
    update public.workspace_members
    set role = p_role
    where workspace_id = p_workspace_id
      and user_id = p_user_id;
    return;
  end if;

  raise exception 'Keine Berechtigung für diese Rollenänderung.';
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Du kannst dich in dieser Ansicht nicht selbst entfernen.';
  end if;

  select wm.role into v_actor_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid();

  select wm.role into v_target_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Mitglied nicht gefunden.';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Der Workspace-Owner kann nicht entfernt werden.';
  end if;

  if v_actor_role = 'owner'
     or (v_actor_role = 'admin' and v_target_role in ('member', 'guest')) then
    delete from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_user_id;
    return;
  end if;

  raise exception 'Keine Berechtigung, dieses Mitglied zu entfernen.';
end;
$$;

revoke all on function public.get_workspace_members(uuid) from public;
revoke all on function public.get_workspace_invitations(uuid) from public;
revoke all on function public.create_workspace_invitation(uuid, text, public.workspace_role) from public;
revoke all on function public.accept_workspace_invitation(uuid) from public;
revoke all on function public.revoke_workspace_invitation(uuid) from public;
revoke all on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) from public;
revoke all on function public.remove_workspace_member(uuid, uuid) from public;

grant execute on function public.get_workspace_members(uuid) to authenticated;
grant execute on function public.get_workspace_invitations(uuid) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, public.workspace_role) to authenticated;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;
grant execute on function public.revoke_workspace_invitation(uuid) to authenticated;
grant execute on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
