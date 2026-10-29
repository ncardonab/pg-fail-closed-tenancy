-- Up Migration

-- One row per change to a tenant table: who made it, what the row looked like
-- before, and what it looks like after. Rows are only ever added.
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  table_name      text NOT NULL,
  row_id          uuid NOT NULL,
  operation       text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id        text NOT NULL,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_row_idx ON audit_log (organization_id, table_name, row_id);

-- Tenants can read their own audit rows and nobody else's.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (organization_id = (SELECT current_org_id()))
  WITH CHECK (organization_id = (SELECT current_org_id()));

-- Writes the audit row for every insert, update and delete on a tenant table.
--
-- The actor comes from the app.user_id setting, which withTenant sets from
-- the verified token. If it is missing, the change is refused: a write with
-- no known author never reaches the table.
--
-- SECURITY DEFINER runs this function as its owner (migrator), so app_user
-- can add audit rows through it without having any write access to
-- audit_log itself. The fixed search_path stops a caller from swapping in
-- their own audit_log table through a schema they control.
--
-- The trigger runs inside the same transaction as the change, so the change
-- and its audit row are saved together or not at all.
CREATE FUNCTION audit_row_change() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  actor  text := NULLIF(current_setting('app.user_id', true), '');
  target record;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'unaudited write on %: app.user_id is not set', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    target := OLD;
  ELSE
    target := NEW;
  END IF;

  INSERT INTO audit_log (organization_id, table_name, row_id, operation, actor_id, before, after)
  VALUES (
    target.organization_id,
    TG_TABLE_NAME,
    target.id,
    TG_OP,
    actor,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );

  RETURN NULL;
END
$$;

CREATE TRIGGER contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- TRUNCATE empties a table without firing row triggers, so it would remove
-- every contact and leave no audit rows. app_user has no TRUNCATE grant; this
-- trigger also stops the table owner and superusers.
CREATE FUNCTION refuse_unaudited_truncate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE on % is not allowed: it would skip the audit trail', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER contacts_no_truncate
  BEFORE TRUNCATE ON contacts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_unaudited_truncate();

-- Blocks any attempt to change or remove audit rows. app_user is already
-- stopped by its grants (it can only read audit_log); this trigger also
-- stops the table owner and superusers.
CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

GRANT SELECT ON audit_log TO app_user;

-- Down Migration

DROP TRIGGER contacts_no_truncate ON contacts;
DROP TRIGGER contacts_audit ON contacts;
DROP TABLE audit_log;
DROP FUNCTION refuse_unaudited_truncate();
DROP FUNCTION audit_row_change();
DROP FUNCTION audit_log_is_append_only();
