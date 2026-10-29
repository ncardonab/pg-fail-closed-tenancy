// Connection settings for the local docker compose database (port 5433).
// Override any of them with environment variables; these defaults are
// local-only and match docker-compose.yml and db/roles.sql.
export const env = {
  // Superuser: creates roles, rebuilds the database, injects faults in tests.
  adminUrl: process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres',
  // Schema owner: runs migrations.
  migratorUrl: process.env.MIGRATOR_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:5433/tenancy',
  // What the application and the test suite connect as.
  appUrl: process.env.APP_DATABASE_URL ?? 'postgres://app_user:app_user@localhost:5433/tenancy',
  jwtSecret: process.env.JWT_SECRET ?? 'local-test-secret',
};

// The demo tenants. Fixed ids so the psql commands in the README work.
export const DEMO_ORGS = {
  a: { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A' },
  b: { id: '00000000-0000-4000-8000-00000000000b', name: 'Org B' },
} as const;
