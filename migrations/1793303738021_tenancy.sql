-- Up Migration

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  full_name       text NOT NULL,
  phone           text NOT NULL,
  consent         text NOT NULL DEFAULT 'unknown'
                  CHECK (consent IN ('opted_in', 'opted_out', 'unknown')),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_organization_id_idx ON contacts (organization_id);

-- Returns the organization the current transaction is acting for. The app
-- sets it in the app.org_id setting at the start of every transaction (see
-- withTenant in src/tenant.ts).
--
-- When no organization is set, it returns NULL. Every policy below compares
-- a row's organization against this value, and a comparison with NULL is
-- never true, so a transaction without an organization sees zero rows and
-- cannot write any.
--
-- NULLIF is there because of connection pools: on a reused connection, an
-- unset app.org_id reads back as an empty string instead of NULL, and
-- turning '' into a uuid raises an error. NULLIF turns '' into NULL first.
CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

-- FORCE applies the policies to the table owner too, so the only roles that
-- skip them are superusers and roles with BYPASSRLS.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

-- Wrapping the call in (SELECT ...) makes Postgres compute the organization
-- once per query and reuse it, instead of calling the function for every row.
CREATE POLICY tenant_isolation ON organizations
  USING (id = (SELECT current_org_id()));

-- USING decides which rows a tenant can see, update or delete. WITH CHECK
-- rejects inserts and updates that would put a row in another tenant.
CREATE POLICY tenant_isolation ON contacts
  USING (organization_id = (SELECT current_org_id()))
  WITH CHECK (organization_id = (SELECT current_org_id()));

-- What the app role is allowed to do. Grants decide which actions it can run
-- on a table; the policies above decide which rows those actions reach.
--
-- USAGE on the schema lets app_user reach the tables in it at all.
-- organizations is read-only for the app: creating a tenant is an admin task.
-- contacts gets the four everyday operations, still limited to the current
-- organization by the policy.
-- Everything else (TRUNCATE, ALTER, DROP, turning RLS off) stays with the
-- owner, and app_user owns nothing.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON organizations TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO app_user;

-- Down Migration

DROP TABLE contacts;
DROP TABLE organizations;
DROP FUNCTION current_org_id();
