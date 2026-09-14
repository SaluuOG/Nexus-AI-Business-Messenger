-- Nexus Phase 3.1 — workspace-scoped customer and project management
-- Apply after 0019_fix_presence_contact_rls.sql.

CREATE TYPE public.customer_status AS ENUM ('lead', 'active', 'inactive');
CREATE TYPE public.project_status AS ENUM (
  'planning',
  'active',
  'review',
  'waiting_customer',
  'completed',
  'archived'
);
CREATE TYPE public.project_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  website text,
  status public.customer_status NOT NULL DEFAULT 'lead',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT customers_contact_name_length CHECK (
    contact_name IS NULL OR char_length(contact_name) <= 120
  ),
  CONSTRAINT customers_email_length CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT customers_phone_length CHECK (phone IS NULL OR char_length(phone) <= 60),
  CONSTRAINT customers_website_length CHECK (website IS NULL OR char_length(website) <= 500),
  CONSTRAINT customers_notes_length CHECK (notes IS NULL OR char_length(notes) <= 4000)
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  status public.project_status NOT NULL DEFAULT 'planning',
  priority public.project_priority NOT NULL DEFAULT 'medium',
  value_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  deadline date,
  progress smallint NOT NULL DEFAULT 0,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_title_length CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  CONSTRAINT projects_value_range CHECK (value_cents BETWEEN 0 AND 999999999999),
  CONSTRAINT projects_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT projects_progress_range CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT projects_description_length CHECK (
    description IS NULL OR char_length(description) <= 4000
  )
);

CREATE INDEX customers_workspace_status_idx
  ON public.customers (workspace_id, status, updated_at DESC);
CREATE INDEX customers_created_by_idx
  ON public.customers (created_by);
CREATE INDEX projects_workspace_status_idx
  ON public.projects (workspace_id, status, updated_at DESC);
CREATE INDEX projects_workspace_deadline_idx
  ON public.projects (workspace_id, deadline)
  WHERE deadline IS NOT NULL;
CREATE INDEX projects_customer_id_idx
  ON public.projects (customer_id);
CREATE INDEX projects_created_by_idx
  ON public.projects (created_by);

-- Scope and audit columns must never be transferable through the browser API.
CREATE FUNCTION public.guard_business_record_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Der Workspace eines Datensatzes kann nicht geändert werden.';
    END IF;
    NEW.created_by := OLD.created_by;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_project_customer_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.customers AS customer
    WHERE customer.id = NEW.customer_id
      AND customer.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Kunde und Projekt müssen zum selben Workspace gehören.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_guard_scope
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.guard_business_record_scope();

CREATE TRIGGER projects_guard_scope
BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.guard_business_record_scope();

CREATE TRIGGER projects_validate_customer_scope
BEFORE INSERT OR UPDATE OF customer_id, workspace_id ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.validate_project_customer_scope();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select_workspace
ON public.customers FOR SELECT
TO authenticated
USING (public.is_workspace_member(workspace_id));

CREATE POLICY customers_insert_managers
ON public.customers FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin']::public.workspace_role[]
  )
);

CREATE POLICY customers_update_team
ON public.customers FOR UPDATE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
)
WITH CHECK (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
);

CREATE POLICY customers_delete_managers
ON public.customers FOR DELETE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin']::public.workspace_role[]
  )
);

CREATE POLICY projects_select_workspace
ON public.projects FOR SELECT
TO authenticated
USING (public.is_workspace_member(workspace_id));

CREATE POLICY projects_insert_managers
ON public.projects FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin']::public.workspace_role[]
  )
);

CREATE POLICY projects_update_team
ON public.projects FOR UPDATE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
)
WITH CHECK (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin', 'member']::public.workspace_role[]
  )
);

CREATE POLICY projects_delete_managers
ON public.projects FOR DELETE
TO authenticated
USING (
  public.has_workspace_role(
    workspace_id,
    ARRAY['owner', 'admin']::public.workspace_role[]
  )
);

GRANT USAGE ON TYPE
  public.customer_status,
  public.project_status,
  public.project_priority
TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_business_record_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.validate_project_customer_scope()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'projects'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
  END IF;
END
$$;
