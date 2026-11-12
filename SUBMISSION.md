# Submission: Ajaia Docs

| Item | Location |
| --- | --- |
| Live product URL | _LIVE_URL_ |
| Walkthrough video | see `VIDEO_URL.txt` |
| Source code | this folder (`server/`, `client/`, `test/`) · GitHub: https://github.com/omar-mohd/assignment |
| Setup & run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Screenshots | `screenshots/` |
| Deployment config | `render.yaml` |
| Automated tests | `test/api.test.js` (`npm test`, 14 tests) |

## Test accounts

Password for all: `password123`.

- `alice@ajaia.test`: owns the seeded "Welcome to Ajaia Docs"
- `bob@ajaia.test`: Editor on it
- `carol@ajaia.test`: Viewer on it

## Status

**Working end to end:** create, rename, rich-text edit (B/I/U, H1–H3, lists, 6 fonts), autosave with a save indicator, reopen; dashboard search and ownership filter; .txt/.md/.docx import into a new document; owner/editor/viewer sharing with owned vs shared views; Postgres persistence; version-conflict protection; validation and error handling; 14 API tests.

**Stretch features done:** real-time collaboration indicators (presence avatars, typing, auto-refresh on others' saves), version history with preview and restore, export to Markdown and PDF, role-based sharing (viewer/editor).

**Intentionally not built:** keystroke-level co-editing (CRDT), comments, real sign-up/auth, images and tables.

**Next 2–4 hours:** Yjs live co-editing with cursors, comments, server-side PDF/.docx export, Playwright E2E in CI.
