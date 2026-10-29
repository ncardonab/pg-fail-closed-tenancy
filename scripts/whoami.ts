// Prints what the application role can and cannot do.
//
//   npm run whoami
import { env } from './env.ts';
import { inspectRole, problemsWith } from './role-check.ts';

const report = await inspectRole(env.appUrl);
const flag = (value: boolean) => (value ? 't' : 'f');

console.log(
  `${report.role} | super=${flag(report.superuser)} | bypassrls=${flag(report.bypassRls)} | owns=${report.ownedTables}`,
);

const problems = problemsWith(report);
if (problems.length > 0) {
  console.log(`Not safe to test with: ${report.role} ${problems.join(', ')}.`);
  process.exitCode = 1;
}
