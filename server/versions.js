// Version history. Autosave fires every ~0.8 s, so storing every save would bury useful history.
// Instead, consecutive saves by the same person within SESSION_MINUTES are folded into one version
// (the same idea as Google Docs' grouped history). Labeled events (create, import, restore) always
// start a new version.
export const SESSION_MINUTES = 10;

export async function recordVersion(db, { documentId, authorId, title, content, label = null }) {
  if (!label) {
    const { rowCount } = await db.query(
      `UPDATE document_versions SET title = $3, content = $4, saved_at = now()
        WHERE id = (SELECT id FROM document_versions WHERE document_id = $1 ORDER BY saved_at DESC, id DESC LIMIT 1)
          AND author_id = $2 AND label IS NULL
          AND saved_at > now() - make_interval(mins => ${SESSION_MINUTES})`,
      [documentId, authorId, title, content],
    );
    if (rowCount) return;
  }
  await db.query(
    `INSERT INTO document_versions (document_id, author_id, title, content, label) VALUES ($1, $2, $3, $4, $5)`,
    [documentId, authorId, title, content, label],
  );
}

export async function listVersions(db, documentId) {
  const { rows } = await db.query(
    `SELECT v.id, v.title, v.label, v.created_at, v.saved_at, u.name AS author_name
       FROM document_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.document_id = $1 ORDER BY v.saved_at DESC, v.id DESC LIMIT 100`,
    [documentId],
  );
  return rows;
}

export async function getVersion(db, documentId, versionId) {
  const { rows } = await db.query(
    `SELECT v.id, v.title, v.content, v.label, v.saved_at, u.name AS author_name
       FROM document_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.document_id = $1 AND v.id = $2`,
    [documentId, versionId],
  );
  return rows[0];
}
