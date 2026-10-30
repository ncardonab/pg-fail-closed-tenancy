import { resetDatabase } from '../scripts/db-reset.ts';
import { env } from '../scripts/env.ts';
import { inspectRole, problemsWith } from '../scripts/role-check.ts';

// Runs once before all test files: rebuild the database, then make sure the
// suite is about to test as a role that row-level security actually applies
// to. If not, stop here instead of reporting a green run that proves nothing.
export default async function setup(): Promise<void> {
  await resetDatabase();

  const report = await inspectRole(env.appUrl);
  const problems = problemsWith(report);
  if (problems.length > 0) {
    // Print and stop the whole run here. Throwing instead makes Vitest 5
    // report "No test files found" and garble the message, which hides the
    // one thing the reader needs to know.
    console.error(
      `\nRefusing to run: ${report.role} ${problems.join(', ')}.\n` +
        'Row-level security would not apply to it, so passing tests would prove nothing.\n' +
        'Point APP_DATABASE_URL at the application role.\n',
    );
    process.exit(1);
  }
}
