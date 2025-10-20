-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid,
  invoice_id uuid,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  updated_at timestamp with time zone,
  CONSTRAINT allocations_pkey PRIMARY KEY (id),
  CONSTRAINT allocations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id),
  CONSTRAINT allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id)
);
CREATE TABLE public.client_companies (
  client_id uuid NOT NULL,
  company_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT client_companies_pkey PRIMARY KEY (client_id, company_id),
  CONSTRAINT client_companies_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id),
  CONSTRAINT client_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  case_worker_email text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);
CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id),
  CONSTRAINT companies_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid,
  name text NOT NULL,
  external_ref text,
  contact_email text,
  terms text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);
CREATE TABLE public.dnr_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  guest_name text NOT NULL,
  zipcode text,
  city text,
  state text,
  reason text,
  hotel_name text,
  confirmation text,
  placed_by text,
  evicted boolean NOT NULL DEFAULT false,
  attachment_path text,
  CONSTRAINT dnr_entries_pkey PRIMARY KEY (id)
);
CREATE TABLE public.expense_approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::expense_approval_status,
  decided_by uuid,
  decided_at timestamp with time zone,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT expense_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT expense_approvals_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id)
);
CREATE TABLE public.expense_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL,
  category_id uuid NOT NULL,
  month date NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT expense_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT expense_budgets_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id),
  CONSTRAINT expense_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id)
);
CREATE TABLE public.expense_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT expense_categories_pkey PRIMARY KEY (id),
  CONSTRAINT expense_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.expense_categories(id)
);
CREATE TABLE public.expense_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  storage_key text NOT NULL,
  filename text,
  size_bytes bigint,
  mime_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT expense_files_pkey PRIMARY KEY (id),
  CONSTRAINT expense_files_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id)
);
CREATE TABLE public.expense_recurring (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL,
  vendor_id uuid,
  category_id uuid,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  method USER-DEFINED NOT NULL DEFAULT 'other'::expense_method,
  reference text,
  notes text,
  frequency USER-DEFINED NOT NULL,
  day_of_month smallint,
  month_of_year smallint,
  weekday smallint,
  next_run_on date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT expense_recurring_pkey PRIMARY KEY (id),
  CONSTRAINT expense_recurring_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id),
  CONSTRAINT expense_recurring_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id),
  CONSTRAINT expense_recurring_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id)
);
CREATE TABLE public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL,
  expense_date date NOT NULL,
  vendor_id uuid,
  category_id uuid,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  method USER-DEFINED NOT NULL DEFAULT 'other'::expense_method,
  reference text,
  notes text,
  attachment_key text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  project_id uuid,
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id),
  CONSTRAINT expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id),
  CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id),
  CONSTRAINT expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.hotels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT hotels_pkey PRIMARY KEY (id),
  CONSTRAINT hotels_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);
CREATE TABLE public.invoice_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  action text NOT NULL,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid,
  user_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  org_id uuid NOT NULL,
  CONSTRAINT invoice_audit_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_audit_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
);
CREATE TABLE public.invoice_problem_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  public_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoice_problem_files_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_problem_files_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.invoice_problems(id)
);
CREATE TABLE public.invoice_problems (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  title text,
  note text,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text])),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone,
  deleted_at timestamp with time zone,
  CONSTRAINT invoice_problems_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_problems_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
);
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid,
  customer_id uuid,
  number text,
  issue_date date NOT NULL DEFAULT now(),
  due_date date NOT NULL DEFAULT (now() + '30 days'::interval),
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric DEFAULT (subtotal + tax),
  status text NOT NULL DEFAULT 'open'::text,
  balance numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  hotel_id uuid NOT NULL,
  company_id uuid,
  client_id uuid,
  confirmation_no text,
  case_no text,
  check_in date,
  check_out date,
  rate_night numeric,
  nights integer DEFAULT GREATEST(0, (check_out - check_in)),
  deleted_at timestamp with time zone,
  updated_at timestamp with time zone,
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id),
  CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT invoices_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id),
  CONSTRAINT invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id)
);
CREATE TABLE public.member_hotels (
  user_id uuid NOT NULL,
  hotel_id uuid NOT NULL,
  deleted_at timestamp with time zone,
  updated_at timestamp with time zone,
  role USER-DEFINED DEFAULT 'front_desk'::app_role,
  CONSTRAINT member_hotels_pkey PRIMARY KEY (user_id, hotel_id),
  CONSTRAINT member_hotels_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT member_hotels_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id)
);
CREATE TABLE public.members (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  role USER-DEFINED DEFAULT 'front_desk'::app_role CHECK (role = ANY (ARRAY['front_desk'::app_role, 'manager'::app_role, 'admin'::app_role, 'staff'::app_role])),
  CONSTRAINT members_pkey PRIMARY KEY (user_id),
  CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);
CREATE TABLE public.org_members (
  user_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'manager'::member_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT org_members_pkey PRIMARY KEY (user_id),
  CONSTRAINT org_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.orgs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  CONSTRAINT orgs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid,
  customer_id uuid,
  method text NOT NULL,
  reference text,
  amount numeric NOT NULL,
  received_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  hotel_id uuid,
  check_date date,
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id),
  CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT payments_hotel_fk FOREIGN KEY (hotel_id) REFERENCES public.hotels(id),
  CONSTRAINT payments_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id)
);
CREATE TABLE public.project_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  store text,
  description text,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  method text NOT NULL CHECK (method = ANY (ARRAY['card'::text, 'check'::text, 'ach'::text, 'other'::text])),
  card_last4 text,
  check_number text,
  attachment_path text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['materials'::text, 'labor'::text])),
  reference text,
  CONSTRAINT project_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT project_expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL,
  name text NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  start_date date,
  end_date date,
  contractor text,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(id)
);
CREATE TABLE public.vendors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  ein text CHECK (ein IS NULL OR ein ~ '^[0-9]{2}-?[0-9]{7}$'::text),
  CONSTRAINT vendors_pkey PRIMARY KEY (id)
);
