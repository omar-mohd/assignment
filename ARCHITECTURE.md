# Architecture note

## Shape

```
Browser (React + TipTap)  ──JSON / multipart──▶  Express API  ──SQL──▶  Postgres (prod) / PGlite (local, tests)
        ▲                                             │
        └────────── same origin, httpOnly cookie ─────┘   one Node service serves both API and built frontend
```

- **One codebase, one origin.** Locally, `npm start` runs Express, serving `/api/*` and the built Vite app. In production on Vercel, the same Express app runs as a single serverless function (`api/index.js`) behind `/api/*`, and the React build is served from Vercel's CDN. Either way there's one URL, no CORS and a same-origin cookie.
- **Deployment:** Vercel Hobby + Neon Postgres, both free with no card. Render was the first plan (`render.yaml` is still included), but it required a card, so I switched. Going serverless had two consequences I handled: presence moved from memory to Postgres, and the upload limit dropped to 4 MB.
- **Data model:** `users`, `documents (owner_id, title, content, version)` and `document_shares (document_id, user_id, role)`. Ownership is a column and grants are rows, so "owned vs shared" is a single query with a `CASE`.

## What I prioritized and why

1. **The editing loop has to feel trustworthy.** Typing, autosave and refresh all have to work, and nothing can get lost. That drove:
   - **Autosave queue:** at most one save is in flight, and edits made meanwhile are merged into the next save. Network errors are retried, and the browser warns before you leave with unsaved changes.
   - **Optimistic concurrency** through a `version` column. A stale write returns `409` with the latest copy, and the user chooses what happens next. I picked this over real-time collaboration because it gives correctness for a fraction of the effort.
2. **Access control enforced on the server, in one place.** `loadDocForUser()` returns the document *with the caller's role*, or a 404. Every route goes through it, so a user without access can't even confirm that a document exists. Edit, share and delete then check that role. Because this is the riskiest logic, it's also where most of the tests are.
3. **Import that produces real documents.** `.docx` goes through mammoth, `.md` through marked, and `.txt` is escaped into paragraphs. All of it is then sanitized down to exactly the tags the editor supports. A .docx with headings and lists comes out as an editable doc with headings and lists.
4. **Zero-friction review.** Seeded users and a seeded shared document, with credentials in the README, and a local run that needs no database install (PGlite).

### Stretch features (added after the core was solid)

- **Collaboration indicators:** a 4-second **heartbeat** (`POST /documents/:id/presence`) records who has a document open and whether they typed recently. It returns the other users plus the current version. If the version moved and the client has no unsaved edits, it pulls the new content in place, keeping the cursor where it was. That gives near-real-time updates **without websockets**: no extra infrastructure, it works on any host, and it reuses the same access check. Presence lives in a small Postgres table (one upsert per heartbeat). I first kept it in memory, but in production the API runs as serverless functions that don't share memory, so I moved it to the database.
- **Version history:** a `document_versions` table. Autosave runs every ~0.8 s, so consecutive saves by the same person within 10 minutes **update one version row** instead of inserting hundreds. Create, import and restore always start a new, labeled version. Restore is append-only (it adds a version rather than deleting anything) and bumps the document version, so other open editors get a conflict, not a silent overwrite of the restore.
- **Export:** Markdown is generated in the browser with Turndown. Underline is kept as `<u>` because Markdown has none, and fonts are dropped. PDF uses the browser's print engine with print CSS that hides the app chrome. That gives selectable text and the right fonts with zero dependencies, at the cost of one extra click ("Save as PDF").
- **Fonts:** six web-safe fonts via TipTap's TextStyle/FontFamily. The server sanitizer allows `<span style="font-family:…">` only for those six names and strips every other style.

## Key decisions and tradeoffs

| Decision | Why | Cost |
| --- | --- | --- |
| **TipTap (ProseMirror)** | Mature schema-based editor. Formatting commands and active-state come for free, and the schema discards anything it can't represent. | ~215 kB gzipped JS bundle (not code-split yet) |
| **Store sanitized HTML** (not ProseMirror JSON) | Imports already produce HTML, the content can be inspected and exported, and the editor round-trips it losslessly for the supported marks | Server must sanitize every write (`sanitize-html` allowlist) |
| **Postgres everywhere, PGlite locally** | Same SQL in dev, tests and prod. Reviewers run `npm install && npm run dev` with nothing else. Tests get a fresh in-memory DB in ms. | PGlite is single-process; fine for local use only |
| **Seeded users + JWT cookie** | The brief allows mocked auth. httpOnly + SameSite=Lax cookie, scrypt hashes, 7-day expiry | No sign-up/reset/SSO |
| **Version check instead of CRDT/OT** | Prevents silent data loss, which is the actual failure mode, in ~40 lines | No live cursors or merges; second writer must choose |
| **Polling heartbeat instead of websockets** | Works on any free host, shares the REST auth/access path, ~60 lines | Updates arrive within ~4 s, not instantly; one tiny DB write per heartbeat |
| **PDF via print dialog** | Real text and fonts, no heavy PDF library | One extra click; layout follows the browser's print engine |
| **404 for "no access"** (not 403) | Doesn't leak document existence | Slightly less specific error |
| **Import creates a new doc** | Clearest product behavior; avoids merge semantics | No "insert file into this doc" yet |

## Deliberately cut

- **Keystroke-level co-editing (Yjs + WebSocket):** the biggest Google Docs feature and the biggest time sink. Conflict detection plus heartbeat refresh cover the correctness and awareness needs. This is the first thing I'd add (see below).
- **Comments and suggestion mode:** valuable, but each one is a feature in its own right.
- **Real identity:** sign-up, password reset and orgs aren't what this exercise evaluates.
- **Images, tables, fonts and colors:** these widen the schema and the sanitizer surface, and they add little to the evaluation.

## Validation & error handling

- Zod schemas on every body (title 1–200 chars, content ≤ 1 MB, valid email, role enum). Errors are returned as `{ error: { message } }` with the right status (400/401/403/404/409/413/415/422).
- Upload: 4 MB multer limit (under Vercel's 4.5 MB request cap), extension allowlist, empty-file check, and corrupt .docx → 422. The UI checks type and size first for instant feedback, and the server is still the authority.
- Central Express error handler. Unknown errors are logged and returned as a generic 500, never as stack traces.

## Next 2–4 hours

1. **Keystroke-level collaboration:** Yjs + `y-websocket` behind the same access check, with live cursors. It would replace the heartbeat's content refresh while keeping the presence UI.
2. **Comments** anchored to text ranges.
3. **Server-side PDF/.docx export**, plus "import into the current doc".
4. **Playwright E2E in CI** for the editor flows I currently verify with a manual script, and code-splitting of the editor bundle.
