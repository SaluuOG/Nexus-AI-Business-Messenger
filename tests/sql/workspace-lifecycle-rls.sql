-- Phase 3.8 acceptance: workspace rename, leave, owner transfer and deletion.
-- All users and records are synthetic; the complete suite is rolled back.
BEGIN;

SELECT set_config('nexus.lifecycle.owner', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.admin', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.member', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.guest', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.outsider', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.unknown_workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.leave_workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.delete_workspace', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.leave_project', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.leave_task', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.delete_customer', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.delete_project', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.delete_task', gen_random_uuid()::text, true);
SELECT set_config('nexus.lifecycle.delete_invitation', gen_random_uuid()::text, true);

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT
  current_setting('nexus.lifecycle.' || person)::uuid,
  current_setting('nexus.lifecycle.' || person) || '@example.invalid',
  now(),
  jsonb_build_object('full_name', initcap(person) || ' Lifecycle')
FROM unnest(ARRAY['owner', 'admin', 'member', 'guest', 'outsider']) AS person;

INSERT INTO public.workspaces(id, owner_id, name) VALUES
  (
    current_setting('nexus.lifecycle.workspace')::uuid,
    current_setting('nexus.lifecycle.owner')::uuid,
    'Lifecycle workspace'
  ),
  (
    current_setting('nexus.lifecycle.leave_workspace')::uuid,
    current_setting('nexus.lifecycle.owner')::uuid,
    'Leave workspace'
  ),
  (
    current_setting('nexus.lifecycle.delete_workspace')::uuid,
    current_setting('nexus.lifecycle.owner')::uuid,
    'Delete exactly'
  );

INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  (
    current_setting('nexus.lifecycle.workspace')::uuid,
    current_setting('nexus.lifecycle.admin')::uuid,
    'admin'
  ),
  (
    current_setting('nexus.lifecycle.workspace')::uuid,
    current_setting('nexus.lifecycle.member')::uuid,
    'member'
  ),
  (
    current_setting('nexus.lifecycle.workspace')::uuid,
    current_setting('nexus.lifecycle.guest')::uuid,
    'guest'
  ),
  (
    current_setting('nexus.lifecycle.leave_workspace')::uuid,
    current_setting('nexus.lifecycle.member')::uuid,
    'member'
  ),
  (
    current_setting('nexus.lifecycle.delete_workspace')::uuid,
    current_setting('nexus.lifecycle.admin')::uuid,
    'admin'
  );

-- Child records prove that leaving preserves work while deletion removes the
-- entire workspace graph. Use an authenticated identity so audit triggers see
-- the same caller shape as production requests.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.owner'),
    'role', 'authenticated'
  )::text,
  true
);

INSERT INTO public.projects(id, workspace_id, title) VALUES (
  current_setting('nexus.lifecycle.leave_project')::uuid,
  current_setting('nexus.lifecycle.leave_workspace')::uuid,
  'Leave assignment project'
);
INSERT INTO public.project_tasks(id, workspace_id, project_id, title, assigned_to) VALUES (
  current_setting('nexus.lifecycle.leave_task')::uuid,
  current_setting('nexus.lifecycle.leave_workspace')::uuid,
  current_setting('nexus.lifecycle.leave_project')::uuid,
  'Keep this task after leave',
  current_setting('nexus.lifecycle.member')::uuid
);

INSERT INTO public.customers(id, workspace_id, name) VALUES (
  current_setting('nexus.lifecycle.delete_customer')::uuid,
  current_setting('nexus.lifecycle.delete_workspace')::uuid,
  'Cascade customer'
);
INSERT INTO public.projects(id, workspace_id, customer_id, title) VALUES (
  current_setting('nexus.lifecycle.delete_project')::uuid,
  current_setting('nexus.lifecycle.delete_workspace')::uuid,
  current_setting('nexus.lifecycle.delete_customer')::uuid,
  'Cascade project'
);
INSERT INTO public.project_tasks(id, workspace_id, project_id, title, assigned_to) VALUES (
  current_setting('nexus.lifecycle.delete_task')::uuid,
  current_setting('nexus.lifecycle.delete_workspace')::uuid,
  current_setting('nexus.lifecycle.delete_project')::uuid,
  'Cascade task',
  current_setting('nexus.lifecycle.admin')::uuid
);
INSERT INTO public.workspace_invitations(
  id, workspace_id, email, role, invited_by
) VALUES (
  current_setting('nexus.lifecycle.delete_invitation')::uuid,
  current_setting('nexus.lifecycle.delete_workspace')::uuid,
  'future-member@example.invalid',
  'member',
  current_setting('nexus.lifecycle.owner')::uuid
);

-- Browser clients may still list/create workspaces but cannot mutate or delete
-- them directly. Only authenticated callers can execute lifecycle RPCs.
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.workspaces', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.workspaces', 'INSERT') THEN
    RAISE EXCEPTION 'Required workspace SELECT/INSERT grant is missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.workspaces', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspaces', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated still has direct workspace UPDATE/DELETE';
  END IF;
  IF has_any_column_privilege('authenticated', 'public.workspaces', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.workspaces', 'UPDATE') THEN
    RAISE EXCEPTION 'A direct workspace column UPDATE grant is still active';
  END IF;
  IF has_table_privilege('authenticated', 'public.workspace_members', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_members', 'DELETE')
     OR has_any_column_privilege(
       'authenticated', 'public.workspace_members', 'INSERT'
     )
     OR has_any_column_privilege(
       'authenticated', 'public.workspace_members', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Authenticated can bypass member lifecycle RPCs';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'workspaces'
      AND grantee IN ('authenticated', 'anon', 'PUBLIC')
      AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'A direct workspace column UPDATE grant is still active';
  END IF;

  IF NOT has_function_privilege(
       'authenticated', 'public.rename_workspace(uuid,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.transfer_workspace_ownership(uuid,uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.leave_workspace(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.delete_workspace(uuid,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.update_workspace_member_role(uuid,uuid,public.workspace_role)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.remove_workspace_member(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Authenticated lifecycle RPC grant is missing';
  END IF;

  IF has_function_privilege('anon', 'public.rename_workspace(uuid,text)', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.transfer_workspace_ownership(uuid,uuid)', 'EXECUTE'
     )
     OR has_function_privilege('anon', 'public.leave_workspace(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_workspace(uuid,text)', 'EXECUTE')
     OR has_function_privilege(
       'anon',
       'public.update_workspace_member_role(uuid,uuid,public.workspace_role)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.remove_workspace_member(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Anonymous lifecycle RPC execution is still enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'rename_workspace',
        'transfer_workspace_ownership',
        'leave_workspace',
        'delete_workspace',
        'update_workspace_member_role',
        'remove_workspace_member'
      )
      AND (
        NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'Lifecycle RPC missing SECURITY DEFINER or fixed search_path';
  END IF;

  BEGIN
    INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES (
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.outsider')::uuid,
      'owner'
    );
    RAISE EXCEPTION 'A second workspace owner was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

-- Admins can rename, including normalized surrounding whitespace, but cannot
-- transfer ownership or delete a workspace.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.admin'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

SELECT public.rename_workspace(
  current_setting('nexus.lifecycle.workspace')::uuid,
  '  Lifecycle Team  '
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = current_setting('nexus.lifecycle.workspace')::uuid
      AND name = 'Lifecycle Team'
  ) THEN
    RAISE EXCEPTION 'Admin rename or name normalization failed';
  END IF;

  BEGIN
    PERFORM public.rename_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid,
      ' '
    );
    RAISE EXCEPTION 'Empty workspace name was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Workspace-Name muss zwischen 2 und 80 Zeichen lang sein.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.transfer_workspace_ownership(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.member')::uuid
    );
    RAISE EXCEPTION 'Admin transferred workspace ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.delete_workspace(
      current_setting('nexus.lifecycle.delete_workspace')::uuid,
      'Delete exactly'
    );
    RAISE EXCEPTION 'Admin deleted the workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE public.workspaces
    SET name = 'Direct bypass'
    WHERE id = current_setting('nexus.lifecycle.workspace')::uuid;
    RAISE EXCEPTION 'Direct workspace UPDATE was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.workspaces
    WHERE id = current_setting('nexus.lifecycle.workspace')::uuid;
    RAISE EXCEPTION 'Direct workspace DELETE was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Guests cannot rename. Outsiders cannot use any lifecycle operation and see
-- no workspace row through RLS, even when they know its UUID.
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.guest'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rename_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid,
      'Guest rename'
    );
    RAISE EXCEPTION 'Guest renamed workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;
END
$$;

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.outsider'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = current_setting('nexus.lifecycle.workspace')::uuid
  ) THEN
    RAISE EXCEPTION 'Workspace leaked to outsider through RLS';
  END IF;

  BEGIN
    PERFORM public.rename_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid,
      'Outsider rename'
    );
    RAISE EXCEPTION 'Outsider renamed workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.transfer_workspace_ownership(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.admin')::uuid
    );
    RAISE EXCEPTION 'Outsider transferred ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.leave_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid
    );
    RAISE EXCEPTION 'Outsider left a workspace they never joined';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.delete_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid,
      'Lifecycle Team'
    );
    RAISE EXCEPTION 'Outsider deleted workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  -- A missing UUID and an existing but inaccessible UUID must produce the
  -- same public error, so callers cannot enumerate workspace existence.
  BEGIN
    PERFORM public.rename_workspace(
      current_setting('nexus.lifecycle.unknown_workspace')::uuid,
      'Unknown rename'
    );
    RAISE EXCEPTION 'Outsider renamed a missing workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.transfer_workspace_ownership(
      current_setting('nexus.lifecycle.unknown_workspace')::uuid,
      current_setting('nexus.lifecycle.admin')::uuid
    );
    RAISE EXCEPTION 'Outsider transferred a missing workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.leave_workspace(
      current_setting('nexus.lifecycle.unknown_workspace')::uuid
    );
    RAISE EXCEPTION 'Outsider left a missing workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.delete_workspace(
      current_setting('nexus.lifecycle.unknown_workspace')::uuid,
      'Unknown workspace'
    );
    RAISE EXCEPTION 'Outsider deleted a missing workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.update_workspace_member_role(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.member')::uuid,
      'guest'
    );
    RAISE EXCEPTION 'Outsider changed a workspace role';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.remove_workspace_member(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.member')::uuid
    );
    RAISE EXCEPTION 'Outsider removed a workspace member';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;
END
$$;

-- Only the current owner can transfer. Guest targets are rejected. Two
-- successive transfers prove that both admin and member targets are eligible.
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.owner'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.leave_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid
    );
    RAISE EXCEPTION 'Owner left without transferring ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Workspace-Owner muss die Ownership zuerst übertragen.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.transfer_workspace_ownership(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.guest')::uuid
    );
    RAISE EXCEPTION 'Guest became workspace owner';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ownership kann nur an Admins oder Member übertragen werden.' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.transfer_workspace_ownership(
    current_setting('nexus.lifecycle.workspace')::uuid,
    current_setting('nexus.lifecycle.admin')::uuid
  );

  BEGIN
    PERFORM public.transfer_workspace_ownership(
      current_setting('nexus.lifecycle.workspace')::uuid,
      current_setting('nexus.lifecycle.member')::uuid
    );
    RAISE EXCEPTION 'Former owner transferred ownership again';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Workspace nicht gefunden oder kein Zugriff.' THEN
      RAISE;
    END IF;
  END;
END
$$;

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.admin'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.transfer_workspace_ownership(
  current_setting('nexus.lifecycle.workspace')::uuid,
  current_setting('nexus.lifecycle.member')::uuid
);

RESET ROLE;
DO $$
DECLARE
  v_owner_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_owner_count
  FROM public.workspace_members
  WHERE workspace_id = current_setting('nexus.lifecycle.workspace')::uuid
    AND role = 'owner';

  IF v_owner_count <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.workspaces
       WHERE id = current_setting('nexus.lifecycle.workspace')::uuid
         AND owner_id = current_setting('nexus.lifecycle.member')::uuid
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_members
       WHERE workspace_id = current_setting('nexus.lifecycle.workspace')::uuid
         AND user_id = current_setting('nexus.lifecycle.member')::uuid
         AND role = 'owner'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_members
       WHERE workspace_id = current_setting('nexus.lifecycle.workspace')::uuid
         AND user_id = current_setting('nexus.lifecycle.owner')::uuid
         AND role = 'admin'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_members
       WHERE workspace_id = current_setting('nexus.lifecycle.workspace')::uuid
         AND user_id = current_setting('nexus.lifecycle.admin')::uuid
         AND role = 'admin'
     ) THEN
    RAISE EXCEPTION 'Transfer did not preserve the one-owner invariant: % owners', v_owner_count;
  END IF;
END
$$;

-- Any non-owner may leave. The membership is removed while an assigned task is
-- retained and automatically becomes unassigned through its composite FK.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.member'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.leave_workspace(
  current_setting('nexus.lifecycle.leave_workspace')::uuid
);

RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = current_setting('nexus.lifecycle.leave_workspace')::uuid
      AND user_id = current_setting('nexus.lifecycle.member')::uuid
  ) THEN
    RAISE EXCEPTION 'Leaving member was not removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_tasks
    WHERE id = current_setting('nexus.lifecycle.leave_task')::uuid
      AND assigned_to IS NULL
  ) THEN
    RAISE EXCEPTION 'Leaving member task was lost or stayed assigned';
  END IF;
END
$$;

-- Guests can leave too, without affecting the remaining ownership invariant.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.guest'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.leave_workspace(current_setting('nexus.lifecycle.workspace')::uuid);

-- Exact deletion confirmation is case- and whitespace-sensitive. Admin cannot delete; owner
-- can delete and every workspace-scoped child row cascades in one transaction.
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('nexus.lifecycle.owner'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.delete_workspace(
      current_setting('nexus.lifecycle.delete_workspace')::uuid,
      'delete exactly'
    );
    RAISE EXCEPTION 'Case-insensitive delete confirmation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Workspace-Name stimmt nicht überein.' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.delete_workspace(
      current_setting('nexus.lifecycle.delete_workspace')::uuid,
      '  Delete exactly  '
    );
    RAISE EXCEPTION 'Whitespace-padded delete confirmation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Workspace-Name stimmt nicht überein.' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.delete_workspace(
    current_setting('nexus.lifecycle.delete_workspace')::uuid,
    'Delete exactly'
  );
END
$$;

RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.workspaces
       WHERE id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.workspace_members
       WHERE workspace_id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.workspace_invitations
       WHERE workspace_id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.customers
       WHERE workspace_id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.projects
       WHERE workspace_id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.project_tasks
       WHERE workspace_id = current_setting('nexus.lifecycle.delete_workspace')::uuid
     ) THEN
    RAISE EXCEPTION 'Workspace deletion left cascading child records behind';
  END IF;
END
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.rename_workspace(
      current_setting('nexus.lifecycle.workspace')::uuid,
      'Anonymous rename'
    );
    RAISE EXCEPTION 'Anonymous caller executed lifecycle RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

RESET ROLE;
-- Keep PASS inside the still-healthy transaction. With default psql error
-- handling, any uncaught earlier error leaves the transaction aborted, so this
-- SELECT cannot print a false PASS before the following ROLLBACK clears it.
SELECT 'PASS: workspace rename, role checks, ownership transfer, one-owner invariant, leave cleanup, exact deletion, cascades, direct-write denial, RLS and anonymous denial; all synthetic records will now be rolled back.' AS result;
ROLLBACK;
