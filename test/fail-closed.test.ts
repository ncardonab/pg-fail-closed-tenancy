import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../scripts/env.ts';
import { verifyTenantToken, withTenant } from '../src/tenant.ts';
import { addContact, adminPool, appPool, claimsFor, createOrg } from './helpers.ts';

// Tables that hold no tenant data and are allowed to skip row-level security.
const GLOBAL_TABLES = ['pgmigrations'];

describe('fails closed when the tenant is missing or unproven', () => {
  const app = appPool();
  const admin = adminPool();
  let orgA: string;

  beforeAll(async () => {
    orgA = await createOrg(admin, 'Fail-closed A');
    await addContact(app, orgA, 'Carla Fixture');
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it('sees no rows when no organization is set', async () => {
    const total = await admin.query('SELECT count(*)::int AS n FROM contacts');
    const visible = await app.query('SELECT count(*)::int AS n FROM contacts');

    expect(total.rows[0].n).toBeGreaterThan(0);
    expect(visible.rows[0].n).toBe(0);
  });

  it('rejects writes when no organization is set', async () => {
    const insert = app.query(
      "INSERT INTO contacts (organization_id, full_name, phone) VALUES ($1, 'No Tenant', '+1-555-0197')",
      [orgA],
    );

    await expect(insert).rejects.toThrow(/violates row-level security policy/);
  });

  it('does not carry the organization over to the next user of a pooled connection', async () => {
    const pool = appPool({ max: 1 });
    try {
      const first = await withTenant(pool, claimsFor(orgA), async (client) => {
        const result = await client.query('SELECT pg_backend_pid() AS pid, count(*)::int AS n FROM contacts');
        return result.rows[0];
      });
      const next = (await pool.query('SELECT pg_backend_pid() AS pid, count(*)::int AS n FROM contacts')).rows[0];

      expect(first.n).toBeGreaterThan(0);
      expect(next.pid).toBe(first.pid);
      expect(next.n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  describe('token verification', () => {
    const sign = (payload: object, secret = env.jwtSecret, options: jwt.SignOptions = {}) =>
      jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '5m', ...options });

    it('accepts a valid token and returns its claims', () => {
      const claims = verifyTenantToken(sign({ sub: 'user-1', organizationId: orgA }), env.jwtSecret);

      expect(claims).toEqual({ sub: 'user-1', organizationId: orgA });
    });

    it('rejects a token signed with another key', () => {
      const forged = sign({ sub: 'user-1', organizationId: orgA }, 'attacker-key');

      expect(() => verifyTenantToken(forged, env.jwtSecret)).toThrow(/invalid signature/);
    });

    it('rejects an expired token', () => {
      const expired = sign({ sub: 'user-1', organizationId: orgA }, env.jwtSecret, { expiresIn: -10 });

      expect(() => verifyTenantToken(expired, env.jwtSecret)).toThrow(/jwt expired/);
    });

    it('rejects an unsigned token', () => {
      const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'user-1', organizationId: orgA })}.`;

      expect(() => verifyTenantToken(unsigned, env.jwtSecret)).toThrow(/signature is required/);
    });

    it('rejects a token without an organization', () => {
      const noOrg = sign({ sub: 'user-1' });

      expect(() => verifyTenantToken(noOrg, env.jwtSecret)).toThrow(/organizationId/);
    });
  });

  // A table added later without row-level security fails here, so it cannot
  // ship unprotected.
  it('has row-level security switched on and forced on every table', async () => {
    const { rows } = await app.query(
      `SELECT c.relname AS "table",
              c.relrowsecurity AND c.relforcerowsecurity
                AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS protected
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> ALL ($1)`,
      [GLOBAL_TABLES],
    );

    expect(rows.map((row) => row.table).sort()).toEqual(['audit_log', 'contacts', 'organizations']);
    expect(rows.filter((row) => !row.protected)).toEqual([]);
  });
});
