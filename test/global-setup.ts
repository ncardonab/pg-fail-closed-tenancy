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
    const message =
      `Refusing to run: ${report.role} ${problems.join(', ')}. ` +
      'Row-level security would not apply to it, so passing tests would prove nothing. ' +
      'Point APP_DATABASE_URL at the application role.';
    const error = new Error(message);
    // Vitest 5.0.5 crashes while source-mapping a stack thrown from global
    // setup and hides the message. The message is the whole point here.
    error.stack = message;
    throw error;
  }
}
