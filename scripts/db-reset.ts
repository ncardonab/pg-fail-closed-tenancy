// Rebuilds the database from zero: roles, empty database, migrations, demo
// data. The test suite runs this before every run, so the migrations are
// proven to apply cleanly each time.
//
//   npm run db:reset
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { withTenant } from '../src/tenant.ts';
import { DEMO_ORGS, env } from './env.ts';

const rolesSql = fileURLToPath(new URL('../db/roles.sql', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

export async function resetDatabase(): Promise<void> {
  const dbName = new URL(env.migratorUrl).pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Unexpected database name: ${dbName}`);
  }

  const admin = new pg.Client({ connectionString: env.adminUrl });
  await admin.connect();
  try {
    await admin.query(await readFile(rolesSql, 'utf8'));
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName} OWNER migrator`);
  } finally {
    await admin.end();
  }

  await runner({
    databaseUrl: env.migratorUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });

  await seedDemoData(dbName);
}

async function seedDemoData(dbName: string): Promise<void> {
  // Creating a tenant is an admin task (app_user can only read organizations).
  const adminUrl = new URL(env.adminUrl);
  adminUrl.pathname = `/${dbName}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    for (const org of Object.values(DEMO_ORGS)) {
      await admin.query('INSERT INTO organizations (id, name) VALUES ($1, $2)', [org.id, org.name]);
    }
  } finally {
    await admin.end();
  }

  // Contacts go in the way the app writes them: as app_user, one tenant per
  // transaction, so even the seed leaves audit rows behind.
  const app = new pg.Pool({ connectionString: env.appUrl });
  const contacts = {
    a: [
      ['Ana Ruiz', '+1-555-0101', 'opted_in'],
      ['Ben Carter', '+1-555-0102', 'unknown'],
    ],
    b: [
      ['Chloe Diaz', '+1-555-0103', 'opted_in'],
      ['Dev Patel', '+1-555-0104', 'opted_out'],
    ],
  } as const;
  try {
    for (const key of ['a', 'b'] as const) {
      await withTenant(app, { sub: 'seed', organizationId: DEMO_ORGS[key].id }, async (client) => {
        for (const [fullName, phone, consent] of contacts[key]) {
          await client.query(
            'INSERT INTO contacts (organization_id, full_name, phone, consent) VALUES ($1, $2, $3, $4)',
            [DEMO_ORGS[key].id, fullName, phone, consent],
          );
        }
      });
    }
  } finally {
    await app.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await resetDatabase();
  console.log('Database rebuilt: roles, migrations, demo data.');
}
