// Alternativa a docker-compose cuando Docker no expone puertos al host.
// PostgreSQL embebido (datos en .pgdata) + maildev (SMTP :1025, UI :1080).
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const dir = '.pgdata';
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'servig', password: 'servig', port: 5433, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  for (let i = 0; ; i++) {
    try { await pg.createDatabase('servig'); break; }
    catch (e) { if (i > 20) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
}
console.log('PostgreSQL listo en 127.0.0.1:5432');

spawn('npx', ['maildev', '--smtp', '1025', '--web', '1080'], { stdio: 'inherit', shell: true });

process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
