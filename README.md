# Ajaia Docs

A lightweight collaborative document editor: create, format, import, share and persist documents in the browser.

**Live demo:** _LIVE_URL_ (free tier: the first load after idle can take ~50 s while the server wakes up)

## Demo accounts

All passwords are `password123`.

| User  | Email              | Seeded role on "Welcome to Ajaia Docs" |
| ----- | ------------------ | -------------------------------------- |
| Alice | `alice@ajaia.test` | Owner                                  |
| Bob   | `bob@ajaia.test`   | Editor                                 |
| Carol | `carol@ajaia.test` | Viewer                                 |

**2-minute review path:** sign in as Alice → create a doc and format it → Share → add `carol@ajaia.test` as Viewer → Sign out → sign in as Carol → the doc is under **Shared with me** and opens read-only.

**See live collaboration:** open the Welcome doc as Alice in one window and as Bob in an incognito window. Each sees the other's avatar, "Bob is typing…" appears while Bob types, and Alice's page picks up Bob's saved changes within a few seconds.

## Features

| Area        | What works                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editing     | Create, rename (click the title), rich text: bold, italic, underline, H1–H3, bulleted and numbered lists, **6 fonts** (Arial, Georgia, Times New Roman, Courier New, Verdana, Trebuchet MS), undo/redo, keyboard shortcuts. Autosaves 0.8 s after you stop typing (spinner "Saving…", then ✓ "Saved"). |
| Dashboard   | **Search** by title and an **"Owned by anyone / Owned by me / Not owned by me"** filter. |
| File upload | **.txt, .md, .docx → new editable document** (button or drag-and-drop on the dashboard). Max 5 MB. Headings, bold/italic and lists are kept. Other types are rejected with a clear message.                                     |
| Sharing     | The owner shares by email as **Editor** or **Viewer**, can change a role or revoke access. The dashboard separates **My documents** from **Shared with me**. Viewers get a read-only editor; only the owner can share or delete. |
| Persistence | Postgres. Content is stored as sanitized HTML, so formatting survives refreshes. Sharing is stored in a `document_shares` table.                                                                                                 |
| Concurrency | Every save carries a version number. If someone else saved first you get a conflict banner (**Load their version** / **Keep mine**) instead of a silent overwrite. |
| Live indicators | Avatars of who else has the document open, a "typing…" indicator, and automatic pull-in of other people's saved changes when you have no unsaved edits. |
| Version history | **History** panel: saves are grouped per person per 10-minute session. Preview any version and **restore** it (editors/owners). Restores are added as new versions, so nothing is lost. |
| Export      | **Markdown (.md)** download, and **PDF** through the browser's print dialog (Save as PDF), printing only the document. |

## Run locally

Requires **Node 20+**. No database setup is needed.

```bash
npm install
npm run dev        # API on :3001, web app on http://localhost:5173
```

Without `DATABASE_URL`, the server uses **PGlite** (Postgres compiled to WebAssembly) and stores data in `./.data/`. Delete that folder to reset to the seeded state.

Production-style run:

```bash
npm run build && npm start   # serves app + API on http://localhost:3001
```

### Environment variables

| Variable         | Default                 | Notes                                                                 |
| ---------------- | ----------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`   | _(unset → PGlite)_      | Postgres connection string. Add `?sslmode=require` for hosted DBs like Neon. |
| `SESSION_SECRET` | dev value               | **Required** when `NODE_ENV=production`.                              |
| `PORT`           | `3001`                  |                                                                       |
| `PGLITE_DIR`     | `./.data/pglite`        | Where local data lives when `DATABASE_URL` is unset.                  |

## Tests

```bash
npm test
```

14 API integration tests (Vitest + Supertest against an in-memory database). They cover auth, create/rename/reopen with formatting, HTML sanitization (including the font allowlist), input validation, version conflicts (409), and the full sharing matrix (no access → 404, viewer can read but not edit/share/delete, role change, revoke). They also cover .md/.docx/.txt import and rejection of unsupported, empty and corrupt files, version-history grouping/restore/permissions, and presence.

## Deploy

`render.yaml` is a Render Blueprint: **Render → New → Blueprint → select this repo**. It creates a free web service plus a free Postgres database and generates `SESSION_SECRET`. Note that Render's free Postgres expires after 30 days. Any Node host plus any Postgres works: set `DATABASE_URL` and `SESSION_SECRET`, build with `npm run build`, start with `npm start`.

## Project layout

```
server/        Express API (app.js routes, db.js schema+seed, auth.js, content.js import/sanitize, versions.js, presence.js)
client/src/    React app (pages/Dashboard, pages/EditorPage, components/Toolbar, ShareDialog, HistoryPanel, Dropdown; export.js)
test/          API tests
```

## Known limitations

- No keystroke-level co-editing: others' changes arrive on save (within a few seconds), not character by character. Simultaneous edits are detected as conflicts, not merged.
- Presence is kept in server memory, so it's correct for one instance only (fine for this deployment).
- Demo auth only (seeded users, no sign-up or password reset).
- Import only creates a new document. It doesn't merge into an existing one, and file attachments aren't stored.
- Images, tables and comments aren't supported.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning and [AI_WORKFLOW.md](AI_WORKFLOW.md) for how AI was used.
