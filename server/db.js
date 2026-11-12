// Database adapter.
// Production: real Postgres via DATABASE_URL (e.g. Render / Neon free tier).
// Local dev + tests: PGlite (Postgres compiled to WASM) so reviewers need zero DB setup,
// and the SQL is identical in every environment.
import crypto from 'node:crypto';
import { hashPassword } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(owner_id);

CREATE TABLE IF NOT EXISTS document_shares (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_shares_user_idx ON document_shares(user_id);

-- Who saved last (used for "Bob saved changes" notices). ALTER keeps older local databases working.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Version history: one row per editing session (consecutive saves by the same person are grouped).
CREATE TABLE IF NOT EXISTS document_versions (
  id          SERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_versions_doc_idx ON document_versions(document_id, saved_at DESC);
`;

export const DEMO_PASSWORD = 'password123';
export const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Owner' },
  { email: 'bob@ajaia.test', name: 'Bob Editor' },
  { email: 'carol@ajaia.test', name: 'Carol Viewer' },
];

const WELCOME_HTML = `<h1>Welcome to Ajaia Docs</h1>
<p>This document is owned by <strong>Alice</strong> and shared with <em>Bob</em> (editor) and <u>Carol</u> (viewer).</p>
<h2>Try it</h2>
<ul><li>Format text with the toolbar or Ctrl/Cmd+B, I, U</li><li>Rename the document by editing the title</li><li>Log in as Bob or Carol to see sharing from the other side</li></ul>
<ol><li>Changes autosave</li><li>Refresh: everything persists</li></ol>`;

export async function createDb({ url, dataDir } = {}) {
  let query, exec, close;

  if (url) {
    const { default: pg } = await import('pg');
    // SSL is driven by the URL (e.g. Neon's "?sslmode=require"); Render's internal URL needs none.
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    query = (sql, params) => pool.query(sql, params);
    exec = (sql) => pool.query(sql);
    close = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    // dataDir undefined => in-memory (used by tests)
    if (dataDir) (await import('node:fs')).mkdirSync(dataDir, { recursive: true });
    const lite = new PGlite(dataDir);
    await lite.waitReady;
    query = (sql, params) => lite.query(sql, params);
    exec = (sql) => lite.exec(sql);
    close = () => lite.close();
  }

  const db = { query, close };
  await exec(SCHEMA);
  await seed(db);
  return db;
}

async function seed(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const ids = {};
  for (const u of DEMO_USERS) {
    const r = await db.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [
      u.email,
      u.name,
      hashPassword(DEMO_PASSWORD),
    ]);
    ids[u.email] = r.rows[0].id;
  }

  const docId = crypto.randomUUID();
  await db.query('INSERT INTO documents (id, owner_id, title, content) VALUES ($1, $2, $3, $4)', [
    docId,
    ids['alice@ajaia.test'],
    'Welcome to Ajaia Docs',
    WELCOME_HTML,
  ]);
  await db.query(
    `INSERT INTO document_versions (document_id, author_id, title, content, label) VALUES ($1, $2, $3, $4, 'Created')`,
    [docId, ids['alice@ajaia.test'], 'Welcome to Ajaia Docs', WELCOME_HTML],
  );
  await db.query(
    `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, 'editor'), ($1, $3, 'viewer')`,
    [docId, ids['bob@ajaia.test'], ids['carol@ajaia.test']],
  );
}
