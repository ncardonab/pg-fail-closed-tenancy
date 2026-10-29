import jwt from 'jsonwebtoken';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

// The only two facts the database needs about a request: who is acting and
// for which organization. Both come from the token, never from the request
// body or URL, so a caller cannot pick another tenant by editing a field.
export const TenantClaims = z.object({
  sub: z.string().min(1),
  organizationId: z.uuid(),
});
export type TenantClaims = z.infer<typeof TenantClaims>;

// Checks the signature and expiry, then the shape of the claims. Throws on any
// failure, so nothing downstream ever sees an unverified organization id.
// HS256 with a shared secret keeps the demo self-contained; a real service
// would verify against its identity provider's public keys (JWKS).
export function verifyTenantToken(token: string, secret: string): TenantClaims {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  return TenantClaims.parse(payload);
}

// Run `work` in a transaction for one organization only.
//
// set_config(..., true) keeps the values for this transaction only. When the
// transaction ends, Postgres clears them. That means the next request on the
// same pooled connection starts with no org context and cannot see the old
// tenant's data.
export async function withTenant<T>(
  pool: Pool,
  claims: TenantClaims,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { sub, organizationId } = TenantClaims.parse(claims);
  const client = await pool.connect();

  // A connection can die while checked out (failover, a killed backend).
  // Without a listener, node-postgres raises that as an unhandled 'error'
  // event and crashes the process. Record it instead, and throw the
  // connection away on release so the pool opens a fresh one.
  let broken = false;
  const markBroken = () => {
    broken = true;
  };
  client.on('error', markBroken);

  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
      [organizationId, sub],
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(markBroken);
    throw error;
  } finally {
    client.off('error', markBroken);
    client.release(broken);
  }
}
