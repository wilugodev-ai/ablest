import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--confirm')) {
  process.stderr.write('Stop the API, then run pnpm admin:reset --confirm to clear the local admin password and sessions. Projects and images are preserved.\n');
  process.exit(1);
}
const filename = process.env.DATA_DIR ? resolve(process.env.DATA_DIR,'content.sqlite') : fileURLToPath(new URL('../.data/content.sqlite',import.meta.url));
if (!existsSync(filename)) { process.stderr.write('No local admin database exists yet.\n'); process.exit(1); }
const db = new DatabaseSync(filename);
db.exec('BEGIN; DELETE FROM sessions; DELETE FROM attempts; DELETE FROM owner;');
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) db.exec("DELETE FROM users WHERE role='admin';");
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='login_attempts'").get()) db.exec('DELETE FROM login_attempts;');
db.exec('COMMIT;');
db.close();
process.stdout.write('Local admin reset. Restart the API and open /admin to set a new password. Your projects and images were preserved.\n');
