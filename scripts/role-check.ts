import pg from 'pg';

export type RoleReport = {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  ownedTables: number;
};

// Describes the role a connection string logs in as. Superusers and roles
// with BYPASSRLS skip row-level security; the owner of a table could turn it
// off. Any of the three would make a passing isolation test meaningless.
export async function inspectRole(connectionString: string): Promise<RoleReport> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<RoleReport>(`
      SELECT r.rolname     AS "role",
             r.rolsuper     AS "superuser",
             r.rolbypassrls AS "bypassRls",
             (SELECT count(*)::int
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relowner = r.oid) AS "ownedTables"
        FROM pg_roles r
       WHERE r.rolname = current_user`);
    return rows[0]!;
  } finally {
    await client.end();
  }
}

export function problemsWith(report: RoleReport): string[] {
  const problems: string[] = [];
  if (report.superuser) problems.push('is a superuser');
  if (report.bypassRls) problems.push('has BYPASSRLS');
  if (report.ownedTables > 0) problems.push(`owns ${report.ownedTables} objects in public`);
  return problems;
}
