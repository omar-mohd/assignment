import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3001;

const secret = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production');
  process.exit(1);
}

const db = await createDb({
  url: process.env.DATABASE_URL,
  dataDir: process.env.PGLITE_DIR || path.join(root, '.data', 'pglite'),
});

const app = createApp({ db, secret, isProd, clientDir: path.join(root, 'client', 'dist') });
app.listen(port, () => {
  console.log(`Ajaia Docs listening on http://localhost:${port} (${process.env.DATABASE_URL ? 'Postgres' : 'PGlite'})`);
});
