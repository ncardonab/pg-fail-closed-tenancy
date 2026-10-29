import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant.ts';
import { addContact, adminPool, appPool, claimsFor, createOrg } from './helpers.ts';

describe('audit trail', () => {
  const app = appPool();
  const admin = adminPool();
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    orgA = await createOrg(admin, 'Audit A');
    orgB = await createOrg(admin, 'Audit B');
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  const auditRowsFor = (rowId: string) =>
    admin
      .query(
        `SELECT operation, actor_id, before->>'consent' AS before, after->>'consent' AS after
           FROM audit_log WHERE row_id = $1 ORDER BY id`,
        [rowId],
      )
      .then((result) => result.rows);

  it('records who changed what, with the row before and after', async () => {
    const contact = await addContact(app, orgA, 'Diego Fixture');

    await withTenant(app, claimsFor(orgA, 'user-ana'), (client) =>
      client.query("UPDATE contacts SET consent = 'opted_out' WHERE id = $1", [contact]),
    );

    expect(await auditRowsFor(contact)).toEqual([
      { operation: 'INSERT', actor_id: 'fixture', before: null, after: 'opted_in' },
      { operation: 'UPDATE', actor_id: 'user-ana', before: 'opted_in', after: 'opted_out' },
    ]);
  });

  it('refuses a change when nobody is named as its author', async () => {
    const contact = await addContact(app, orgA, 'Elena Fixture');
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgA]);

      await expect(
        client.query("UPDATE contacts SET consent = 'unknown' WHERE id = $1", [contact]),
      ).rejects.toThrow(/unaudited write on contacts/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it("hides one organization's audit rows from another", async () => {
    const contact = await addContact(app, orgA, 'Farah Fixture');

    const seenByB = await withTenant(app, claimsFor(orgB), async (client) => {
      const result = await client.query('SELECT count(*)::int AS n FROM audit_log WHERE row_id = $1', [contact]);
      return result.rows[0].n;
    });

    expect(seenByB).toBe(0);
  });

  it('lets nobody rewrite history, not even a superuser', async () => {
    // The guard is a row trigger: it only fires if there is a row to touch.
    await addContact(app, orgA, 'Hana Fixture');

    // app_user can only read audit_log.
    await expect(
      withTenant(app, claimsFor(orgA), (client) => client.query('DELETE FROM audit_log')),
    ).rejects.toThrow(/permission denied for table audit_log/);
    await expect(
      withTenant(app, claimsFor(orgA), (client) => client.query("UPDATE audit_log SET actor_id = 'someone-else'")),
    ).rejects.toThrow(/permission denied for table audit_log/);

    // A superuser skips grants and row-level security, but not the trigger.
    await expect(admin.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    await expect(admin.query("UPDATE audit_log SET actor_id = 'someone-else'")).rejects.toThrow(/append-only/);
    await expect(admin.query('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
  });

  // TRUNCATE skips row triggers, so it would empty contacts with no audit
  // rows. Run inside a transaction that is always rolled back: if the guard
  // ever goes missing, the other test files keep their data.
  it('refuses TRUNCATE on contacts, even for a superuser', async () => {
    await addContact(app, orgA, 'Ines Fixture');
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('TRUNCATE contacts')).rejects.toThrow(/would skip the audit trail/);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await expect(client.query('TRUNCATE organizations CASCADE')).rejects.toThrow(/would skip the audit trail/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // Fault injection: the connection dies after the UPDATE ran (and its audit
  // row was written) but before COMMIT. Neither may survive, and the pool
  // must keep working afterwards.
  it('keeps neither the change nor its audit row when the connection dies mid-transaction', async () => {
    const contact = await addContact(app, orgA, 'Gabriel Fixture');
    const pool = appPool({ max: 1 });
    try {
      const killedMidway = withTenant(pool, claimsFor(orgA, 'user-ana'), async (client) => {
        await client.query("UPDATE contacts SET consent = 'opted_out' WHERE id = $1", [contact]);
        const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
        await admin.query('SELECT pg_terminate_backend($1, 5000)', [rows[0].pid]);
      });

      await expect(killedMidway).rejects.toThrow(/terminat|not queryable/i);

      const saved = await admin.query('SELECT consent FROM contacts WHERE id = $1', [contact]);
      expect(saved.rows).toEqual([{ consent: 'opted_in' }]);
      expect(await auditRowsFor(contact)).toEqual([
        { operation: 'INSERT', actor_id: 'fixture', before: null, after: 'opted_in' },
      ]);

      const afterRecovery = await withTenant(pool, claimsFor(orgA), async (client) => {
        const result = await client.query('SELECT count(*)::int AS n FROM contacts WHERE id = $1', [contact]);
        return result.rows[0].n;
      });
      expect(afterRecovery).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
