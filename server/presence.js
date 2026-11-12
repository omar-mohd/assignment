// "Who's here" indicators. Clients send a heartbeat every few seconds; anyone not seen for
// STALE_MS drops off. Kept in memory on purpose: presence is ephemeral and this app runs as a
// single instance. Multiple instances would move this to Redis (or a websocket hub).
const STALE_MS = 15_000;
const TYPING_MS = 4_000;

export function createPresence(now = () => Date.now()) {
  const docs = new Map(); // docId -> Map(userId -> { id, name, lastSeen, lastTyped })

  return {
    beat(docId, user, { typing = false } = {}) {
      if (!docs.has(docId)) docs.set(docId, new Map());
      const entries = docs.get(docId);
      const prev = entries.get(user.id);
      entries.set(user.id, {
        id: user.id,
        name: user.name,
        lastSeen: now(),
        lastTyped: typing ? now() : (prev?.lastTyped ?? 0),
      });
    },
    leave(docId, userId) {
      docs.get(docId)?.delete(userId);
    },
    /** Active users on a document, excluding `exceptUserId`. */
    list(docId, exceptUserId) {
      const entries = docs.get(docId);
      if (!entries) return [];
      const t = now();
      const active = [];
      for (const [id, e] of entries) {
        if (t - e.lastSeen > STALE_MS) entries.delete(id);
        else if (id !== exceptUserId) active.push({ id, name: e.name, typing: t - e.lastTyped < TYPING_MS });
      }
      return active;
    },
  };
}
