import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { z } from 'zod';
import { COOKIE_NAME, cookieOptions, requireAuth, signSession, verifyPassword } from './auth.js';
import { HttpError } from './errors.js';
import { getVersion, listVersions, recordVersion } from './versions.js';
import { createPresence } from './presence.js';
import { MAX_CONTENT_BYTES, MAX_UPLOAD_BYTES, fileToDocument, sanitizeContent } from './content.js';

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title cannot be empty')
  .max(200, 'Title is too long (max 200 characters)');
const contentSchema = z
  .string()
  .refine((s) => Buffer.byteLength(s) <= MAX_CONTENT_BYTES, 'Document is too large (max 1 MB)');

const schemas = {
  login: z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: z.string().min(1, 'Password is required'),
  }),
  createDoc: z.object({ title: titleSchema.optional(), content: contentSchema.optional() }),
  updateDoc: z
    .object({ title: titleSchema.optional(), content: contentSchema.optional(), version: z.number().int().positive() })
    .refine((b) => b.title !== undefined || b.content !== undefined, 'Nothing to update'),
  share: z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    role: z.enum(['viewer', 'editor']),
  }),
};

function parse(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new HttpError(400, result.error.issues[0].message);
  return result.data;
}

const DOC_COLUMNS = `d.id, d.title, d.content, d.version, d.created_at, d.updated_at,
  d.owner_id, u.name AS owner_name, u.email AS owner_email, d.updated_by, ub.name AS updated_by_name`;

/** Returns the document plus the caller's role, or throws 404 (we don't reveal docs you can't access). */
async function loadDocForUser(db, docId, userId) {
  const { rows } = await db.query(
    `SELECT ${DOC_COLUMNS}, CASE WHEN d.owner_id = $2 THEN 'owner' ELSE s.role END AS role
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN users ub ON ub.id = d.updated_by
       LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = $2
      WHERE d.id = $1 AND (d.owner_id = $2 OR s.user_id IS NOT NULL)`,
    [docId, userId],
  );
  if (!rows[0]) throw new HttpError(404, 'Document not found');
  return rows[0];
}

async function listShares(db, docId) {
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.email, u.name, s.role
       FROM document_shares s JOIN users u ON u.id = s.user_id
      WHERE s.document_id = $1 ORDER BY u.name`,
    [docId],
  );
  return rows;
}

const canEdit = (role) => role === 'owner' || role === 'editor';

export function createApp({ db, secret, isProd = false, clientDir }) {
  const presence = createPresence(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  const auth = requireAuth(db, secret);
  const api = express.Router();

  api.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  // ---- Auth -------------------------------------------------------------
  api.post('/auth/login', async (req, res) => {
    const { email, password } = parse(schemas.login, req.body);
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid email or password');
    res.cookie(COOKIE_NAME, signSession(user, secret), cookieOptions(isProd));
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  api.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(isProd), maxAge: undefined });
    res.status(204).end();
  });

  api.get('/auth/me', auth, (req, res) => res.json({ user: req.user }));

  // Directory for the share dialog. Fine for an internal tool with a handful of users.
  api.get('/users', auth, async (req, res) => {
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE id <> $1 ORDER BY name', [req.user.id]);
    res.json({ users: rows });
  });

  // ---- Documents --------------------------------------------------------
  api.get('/documents', auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.id, d.title, d.updated_at, d.owner_id, u.name AS owner_name,
              CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role END AS role
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = $1
        WHERE d.owner_id = $1 OR s.user_id IS NOT NULL
        ORDER BY d.updated_at DESC`,
      [req.user.id],
    );
    res.json({ owned: rows.filter((d) => d.role === 'owner'), shared: rows.filter((d) => d.role !== 'owner') });
  });

  async function insertDoc(ownerId, title, html, label) {
    const content = sanitizeContent(html);
    const { rows } = await db.query(
      'INSERT INTO documents (id, owner_id, title, content, updated_by) VALUES ($1, $2, $3, $4, $2) RETURNING id',
      [crypto.randomUUID(), ownerId, title, content],
    );
    await recordVersion(db, { documentId: rows[0].id, authorId: ownerId, title, content, label });
    return loadDocForUser(db, rows[0].id, ownerId);
  }

  api.post('/documents', auth, async (req, res) => {
    const body = parse(schemas.createDoc, req.body);
    const doc = await insertDoc(req.user.id, body.title ?? 'Untitled document', body.content ?? '', 'Created');
    res.status(201).json({ document: doc });
  });

  // Upload .txt / .md / .docx -> new editable document owned by the caller.
  api.post('/documents/import', auth, upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload (field name "file")');
    const { title, html } = await fileToDocument(req.file);
    const doc = await insertDoc(req.user.id, title, html, `Imported from ${req.file.originalname}`);
    res.status(201).json({ document: doc });
  });

  api.get('/documents/:id', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    const shares = doc.role === 'owner' ? await listShares(db, doc.id) : undefined;
    res.json({ document: doc, shares });
  });

  // Optimistic concurrency: the client sends the version it last saw.
  // A mismatch means someone else saved in between -> 409 with the latest copy, never a silent overwrite.
  api.patch('/documents/:id', auth, async (req, res) => {
    const body = parse(schemas.updateDoc, req.body);
    const current = await loadDocForUser(db, req.params.id, req.user.id);
    if (!canEdit(current.role)) throw new HttpError(403, 'You have view-only access to this document');

    const { rowCount } = await db.query(
      `UPDATE documents
          SET title = COALESCE($2, title), content = COALESCE($3, content),
              version = version + 1, updated_at = now(), updated_by = $5
        WHERE id = $1 AND version = $4`,
      [
        current.id,
        body.title ?? null,
        body.content === undefined ? null : sanitizeContent(body.content),
        body.version,
        req.user.id,
      ],
    );
    const latest = await loadDocForUser(db, current.id, req.user.id);
    if (!rowCount) {
      throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.', {
        document: latest,
      });
    }
    await recordVersion(db, {
      documentId: latest.id,
      authorId: req.user.id,
      title: latest.title,
      content: latest.content,
    });
    res.json({ document: latest });
  });

  // ---- Version history --------------------------------------------------
  api.get('/documents/:id/versions', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    res.json({ versions: await listVersions(db, doc.id) });
  });

  api.get('/documents/:id/versions/:versionId', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    const version = await getVersion(db, doc.id, Number(req.params.versionId) || 0);
    if (!version) throw new HttpError(404, 'Version not found');
    res.json({ version });
  });

  // Restoring is an explicit user action, so it doesn't need a version match; it creates a new
  // version (history is append-only, nothing is lost) and bumps the document version so other
  // open editors get a conflict instead of overwriting the restore.
  api.post('/documents/:id/versions/:versionId/restore', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    if (!canEdit(doc.role)) throw new HttpError(403, 'You have view-only access to this document');
    const version = await getVersion(db, doc.id, Number(req.params.versionId) || 0);
    if (!version) throw new HttpError(404, 'Version not found');

    await db.query(
      `UPDATE documents SET title = $2, content = $3, version = version + 1, updated_at = now(), updated_by = $4
        WHERE id = $1`,
      [doc.id, version.title, version.content, req.user.id],
    );
    const when = new Date(version.saved_at).toISOString().slice(0, 16).replace('T', ' ');
    await recordVersion(db, {
      documentId: doc.id,
      authorId: req.user.id,
      title: version.title,
      content: version.content,
      label: `Restored version from ${when} UTC`,
    });
    res.json({ document: await loadDocForUser(db, doc.id, req.user.id) });
  });

  // ---- Presence (who else is here) ---------------------------------------
  // Heartbeat: records the caller and returns the others plus the current version, so clients
  // can also notice saves made by other people without a full reload.
  api.post('/documents/:id/presence', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    await presence.beat(doc.id, req.user, { typing: req.body?.typing === true });
    res.json({
      users: await presence.list(doc.id, req.user.id),
      version: doc.version,
      updated_at: doc.updated_at,
      updated_by_name: doc.updated_by_name,
    });
  });

  api.delete('/documents/:id/presence', auth, async (req, res) => {
    await presence.leave(req.params.id, req.user.id);
    res.status(204).end();
  });

  api.delete('/documents/:id', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    if (doc.role !== 'owner') throw new HttpError(403, 'Only the owner can delete this document');
    await db.query('DELETE FROM documents WHERE id = $1', [doc.id]);
    res.status(204).end();
  });

  // ---- Sharing (owner only) ---------------------------------------------
  api.post('/documents/:id/shares', auth, async (req, res) => {
    const { email, role } = parse(schemas.share, req.body);
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    if (doc.role !== 'owner') throw new HttpError(403, 'Only the owner can share this document');

    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!rows[0]) throw new HttpError(404, `No user with email ${email}`);
    if (rows[0].id === req.user.id) throw new HttpError(400, 'You already own this document');

    // Upsert so changing someone's role is the same action as sharing.
    await db.query(
      `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [doc.id, rows[0].id, role],
    );
    res.json({ shares: await listShares(db, doc.id) });
  });

  api.delete('/documents/:id/shares/:userId', auth, async (req, res) => {
    const doc = await loadDocForUser(db, req.params.id, req.user.id);
    if (doc.role !== 'owner') throw new HttpError(403, 'Only the owner can change sharing');
    await db.query('DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2', [
      doc.id,
      Number(req.params.userId),
    ]);
    res.json({ shares: await listShares(db, doc.id) });
  });

  api.use((_req, _res) => {
    throw new HttpError(404, 'Not found');
  });

  app.use('/api', api);

  // ---- Static frontend (production build) -------------------------------
  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  // ---- Errors -----------------------------------------------------------
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` : err.message;
      return res.status(status).json({ error: { message } });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { message: 'Request is too large' } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'Malformed JSON body' } });
    if (err instanceof HttpError) return res.status(err.status).json({ error: { message: err.message, ...err.extra } });
    console.error(err);
    res.status(500).json({ error: { message: 'Something went wrong on our side' } });
  });

  return app;
}
