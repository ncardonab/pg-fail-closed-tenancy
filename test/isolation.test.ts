import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant.ts';
import { addContact, adminPool, appPool, claimsFor, createOrg } from './helpers.ts';

describe('tenant isolation, tested as app_user', () => {
  const app = appPool();
  const admin = adminPool();
  let orgA: string;
  let orgB: string;
  let contactA: string;
  let contactB: string;

  beforeAll(async () => {
    orgA = await createOrg(admin, 'Isolation A');
    orgB = await createOrg(admin, 'Isolation B');
    contactA = await addContact(app, orgA, 'Alice Fixture');
    contactB = await addContact(app, orgB, 'Bruno Fixture');
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it('reads only its own rows', async () => {
    const rows = await withTenant(app, claimsFor(orgA), async (client) => {
      const result = await client.query('SELECT id, organization_id FROM contacts');
      return result.rows;
    });

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(contactA);
    expect(ids).not.toContain(contactB);
    expect(new Set(rows.map((row) => row.organization_id))).toEqual(new Set([orgA]));
  });

  it("cannot update or delete another organization's rows", async () => {
    const [updated, deleted] = await withTenant(app, claimsFor(orgA), async (client) => [
      (await client.query("UPDATE contacts SET consent = 'opted_out' WHERE id = $1", [contactB])).rowCount,
      (await client.query('DELETE FROM contacts WHERE id = $1', [contactB])).rowCount,
    ]);

    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    const { rows } = await admin.query('SELECT consent FROM contacts WHERE id = $1', [contactB]);
    expect(rows).toEqual([{ consent: 'opted_in' }]);
  });

  it('cannot insert a row into another organization', async () => {
    const insertIntoB = withTenant(app, claimsFor(orgA), (client) =>
      client.query(
        "INSERT INTO contacts (organization_id, full_name, phone) VALUES ($1, 'Planted', '+1-555-0198')",
        [orgB],
      ),
    );

    await expect(insertIntoB).rejects.toThrow(/violates row-level security policy/);
  });

  it('cannot move its own row into another organization', async () => {
    const moveToB = withTenant(app, claimsFor(orgA), (client) =>
      client.query('UPDATE contacts SET organization_id = $1 WHERE id = $2', [orgB, contactA]),
    );

    await expect(moveToB).rejects.toThrow(/violates row-level security policy/);
  });
});
