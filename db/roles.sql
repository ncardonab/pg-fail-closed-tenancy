-- Cluster-level roles. Runs as a superuser before migrations; safe to re-run.
--
-- migrator  owns the schema and runs migrations.
-- app_user  is what the application connects as: it owns nothing, is not a
--           superuser and cannot bypass row-level security. The test suite
--           connects as this role and refuses to run as anything stronger.
--
-- Passwords are local-only defaults for the docker compose database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN PASSWORD 'migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

-- Re-assert the attributes on every run, so a role that drifted gets fixed.
ALTER ROLE migrator NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT;
