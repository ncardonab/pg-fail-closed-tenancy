import pg from "pg";
import { env } from "../scripts/env.ts";
import { withTenant, type TenantClaims } from "../src/tenant.ts";

// The connection under test: the application role, same as production.
export function appPool(options: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({ connectionString: env.appUrl, ...options });
}

// Superuser on the same database. Only for setting up fixtures, checking
// what really got saved, and injecting faults; never for the assertions
// about what a tenant can do.
export function adminPool(): pg.Pool {
  const url = new URL(env.adminUrl);
  url.pathname = new URL(env.appUrl).pathname;
  return new pg.Pool({ connectionString: url.toString() });
}

export function claimsFor(
  organizationId: string,
  sub = "test-user"
): TenantClaims {
  return { sub, organizationId };
}

export async function createOrg(admin: pg.Pool, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
    [name]
  );
  return rows[0]!.id;
}

export async function addContact(
  app: pg.Pool,
  organizationId: string,
  fullName: string
): Promise<string> {
  return withTenant(
    app,
    claimsFor(organizationId, "fixture"),
    async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO contacts (organization_id, full_name, phone, consent)
       VALUES ($1, $2, '+1-555-0199', 'opted_in') RETURNING id`,
        [organizationId, fullName]
      );
      return rows[0]!.id;
    }
  );
}
