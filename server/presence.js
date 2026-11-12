// "Who's here" indicators. Clients send a heartbeat every few seconds; anyone not seen for
// STALE_SECONDS drops off. Stored in Postgres (not memory) so it stays correct when the API runs
// as several serverless instances, e.g. on Vercel. One tiny upsert per user per heartbeat.
const STALE_SECONDS = 15;
const TYPING_SECONDS = 4;

export function createPresence(db) {
  return {
    async beat(docId, user, { typing = false } = {}) {
      await db.query(
        `INSERT INTO document_presence (document_id, user_id, last_seen, last_typed)
         VALUES ($1, $2, now(), CASE WHEN $3 THEN now() END)
         ON CONFLICT (document_id, user_id) DO UPDATE
           SET last_seen = now(),
               last_typed = CASE WHEN $3 THEN now() ELSE document_presence.last_typed END`,
        [docId, user.id, typing],
      );
    },
    async leave(docId, userId) {
      await db.query('DELETE FROM document_presence WHERE document_id = $1 AND user_id = $2', [docId, userId]);
    },
    /** Active users on a document, excluding `exceptUserId`. */
    async list(docId, exceptUserId) {
      const { rows } = await db.query(
        `SELECT p.user_id AS id, u.name,
                COALESCE(p.last_typed > now() - make_interval(secs => ${TYPING_SECONDS}), false) AS typing
           FROM document_presence p JOIN users u ON u.id = p.user_id
          WHERE p.document_id = $1 AND p.user_id <> $2
            AND p.last_seen > now() - make_interval(secs => ${STALE_SECONDS})
          ORDER BY u.name`,
        [docId, exceptUserId],
      );
      return rows;
    },
  };
}
