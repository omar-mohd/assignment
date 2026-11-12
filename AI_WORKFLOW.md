# AI workflow note

## Tools used

- **Claude (Opus, agentic coding session)** wrote most of the code and the docs, ran the tests, and drove a headless browser to verify the UI.
- **Me:** scope, product decisions, review of every change, and the final call on what shipped.
- **Headless Chrome via Playwright scripts** for UI verification and screenshots. Vitest/Supertest for automated tests.

## How I worked with it

1. **Plan before code.** I had the AI restate the brief as a scoped plan: stack, what's in, what's cut, and the reasons. I reviewed that plan before building, so the scope cuts in ARCHITECTURE.md were decided up front, not discovered at the deadline.
2. **Build in vertical slices and verify each one:** backend first, smoke-tested with `curl` (login → list → import → reject bad file). Then the UI, verified in a real browser. Then tests.
3. **Make the AI prove its claims.** Every feature claim in the README was checked with a test, a curl call or a browser run.

## Where AI materially sped things up

- Scaffolding Express, Vite, TipTap and PGlite, plus the CRUD and sharing routes, in minutes instead of an hour or more.
- The import pipeline (mammoth/marked/sanitize-html), including the sanitizer allowlist matched to the editor schema.
- Writing the 10-case API test suite and the Playwright scripts. This is where AI saves the most time, because good tests are tedious to write by hand.
- First drafts of the README and this note.
- The second round of product requests (search, ownership filter, fonts, save indicator, presence, history, export). The AI turned each into a design and a backend/frontend/test change in one pass, so I could spend my time reviewing behavior.

## What was changed or rejected

Real issues caught during review and verification, all fixed before shipping:

| AI output | Problem | Fix |
| --- | --- | --- |
| Installed separate TipTap Underline/Placeholder packages | Out of date for TipTap v3: StarterKit already bundles Underline, so it would have been registered twice | Checked the installed package, removed the extras, imported Placeholder from `@tiptap/extensions` |
| `pg` pool with `ssl: { rejectUnauthorized: false }` for any remote host | Silently disables certificate verification | Rejected. SSL now comes from the connection string (`sslmode=require`) |
| Autosave timer logic | A stale timer id meant edits typed *while a save was in flight* could sit unsaved until the next keystroke | Reset the timer id when it fires and re-flush after each save |
| Loading a doc called `editor.setEditable()` | It emits an update event, so **viewers saw "Unsaved changes" and the client attempted a save** (the server correctly returned 403). Caught from a screenshot, not by reading code | `setEditable(x, false)` plus an `isEditable` guard. Save status hidden for viewers |
| Sign-out kept the "return to" URL | Signing in as a different user reopened the previous user's document | Sign-out navigates to a clean `/login` |
| Auth context lived in `main.jsx` | Circular import between pages and entry point | Moved to `auth.jsx` |
| Toolbar button component defined inside render | Remounts every render | Hoisted to module scope |
| Sanitizer edit for fonts (script-based find/replace) | Prettier had reformatted the tag list, so the replacement silently didn't apply. Fonts would have been stripped on save | Spotted on review and applied by hand. A test now checks the font allowlist (kept: Georgia; stripped: Comic Sans + `color`) |
| Presence stored in server memory | Fine on one server, but wrong once the deploy target became serverless (Vercel), where instances don't share memory | Moved presence into a Postgres table. Same API, same tests |
| Markdown export prepended `# Title` | Docs that already start with an H1 got the title twice. Caught by reading the exported file in the browser test | Export the body as is |

## How correctness, UX and reliability were verified

- **Automated:** `npm test` runs 14 API integration tests on a fresh in-memory Postgres (PGlite): auth, persistence plus sanitization, validation, 409 conflicts, the sharing and permission matrix, and .md/.docx/.txt import with negative cases.
- **Testing the tests:** I deliberately broke the permission check (`canEdit = () => true`) and confirmed the suite fails, then restored it. A passing test suite only counts if it can fail.
- **Real browser:** Playwright scripts in headless Chrome ran the full flow. They covered login, create, format, rename, reload (formatting persisted), share, the share error for an unknown email, viewer read-only, and .docx import through the file picker. A **3-user concurrent session** (Alice/Bob/Carol) exercised the conflict banner. For the stretch features, two live sessions checked that each side sees the other's avatar, "Bob is typing…" appears, Bob's save shows up in Alice's editor automatically, a restore propagates back to Bob, and the exported .md file is correct. I reviewed the screenshots for UX, not only assertions.
- **Production database path:** the tests use embedded Postgres, so I also ran the Vercel entry point (`api/index.js`) against a real Postgres wire-protocol server through the `pg` driver. Health, login (it confirmed the cookie is `Secure; HttpOnly; SameSite=Lax`), save with fonts, presence, history, import and the 4 MB limit all passed.
- **Deployed build:** re-ran the main flow against the live URL after deploy.

## Takeaway

AI was fastest at breadth: scaffolding, boilerplate, tests and docs. Human review mattered most at the seams: library-version assumptions, security defaults, async edge cases and UX states that only show up on screen. The highest-value habit was **making the AI verify in a real browser** instead of trusting code that "looks right".
