import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { FontFamily, TextStyle } from '@tiptap/extension-text-style';
import { api } from '../api.js';
import { downloadMarkdown, exportPdf } from '../export.js';
import Header from '../components/Header.jsx';
import Toolbar from '../components/Toolbar.jsx';
import ShareDialog from '../components/ShareDialog.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import Dropdown from '../components/Dropdown.jsx';

const AUTOSAVE_MS = 800;
const HEARTBEAT_MS = 4000;
const TYPING_WINDOW_MS = 4000;

/**
 * Autosave queue: at most one PATCH in flight; edits made meanwhile are merged and sent next.
 * Every save carries the last version we saw so the server can reject stale writes (409).
 */
function useAutosave(docId, { onSaved, onConflict }) {
  const pending = useRef({});
  const version = useRef(null);
  const inFlight = useRef(false);
  const timer = useRef(null);
  const halted = useRef(false);
  const lastEdit = useRef(0);
  const [status, setStatus] = useState('idle');

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current || halted.current || !Object.keys(pending.current).length) return;
    const fields = pending.current;
    pending.current = {};
    inFlight.current = true;
    setStatus('saving');
    try {
      const { document } = await api.updateDoc(docId, { ...fields, version: version.current });
      version.current = document.version;
      onSaved(document);
      setStatus(Object.keys(pending.current).length ? 'unsaved' : 'saved');
    } catch (e) {
      if (e.status === 409) {
        halted.current = true;
        pending.current = { ...fields, ...pending.current };
        onConflict(e.data.document);
        setStatus('idle');
      } else if ([400, 403, 404, 413].includes(e.status)) {
        halted.current = true;
        setStatus('idle');
        onConflict(null, e.message);
      } else {
        // Transient (network/5xx): keep the edits and retry.
        pending.current = { ...fields, ...pending.current };
        setStatus('error');
        timer.current = setTimeout(() => {
          timer.current = null;
          flush();
        }, 3000);
      }
    } finally {
      inFlight.current = false;
      if (!halted.current && Object.keys(pending.current).length && !timer.current) flush();
    }
  }, [docId, onSaved, onConflict]);

  const queue = useCallback(
    (fields, { immediate = false } = {}) => {
      pending.current = { ...pending.current, ...fields };
      lastEdit.current = Date.now();
      setStatus('unsaved');
      clearTimeout(timer.current);
      timer.current = null;
      if (immediate) flush();
      else
        timer.current = setTimeout(() => {
          timer.current = null;
          flush();
        }, AUTOSAVE_MS);
    },
    [flush],
  );

  const reset = useCallback((v) => {
    version.current = v;
    halted.current = false;
    pending.current = {};
    clearTimeout(timer.current);
    timer.current = null;
    setStatus('saved');
  }, []);

  /** True when nothing local is unsaved, so it's safe to replace the content with the server's. */
  const isIdle = useCallback(
    () => !inFlight.current && !halted.current && !timer.current && !Object.keys(pending.current).length,
    [],
  );

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (Object.keys(pending.current).length || inFlight.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [flush]);

  return { status, queue, reset, isIdle, pending, version, lastEdit };
}

/**
 * Presence heartbeat: tells the server we're here (and whether we're typing), gets back who else is
 * here plus the latest version number. A newer version while we have no local edits = someone else
 * saved, so `onRemoteChange` pulls their changes in (near-real-time updates without websockets).
 */
function usePresence(docId, enabled, autosave, onRemoteChange) {
  const [others, setOthers] = useState([]);
  const remote = useRef(onRemoteChange);
  remote.current = onRemoteChange;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const beat = async () => {
      try {
        const typing = Date.now() - autosave.lastEdit.current < TYPING_WINDOW_MS;
        const r = await api.heartbeat(docId, typing);
        if (stopped) return;
        setOthers(r.users);
        if (r.version > autosave.version.current && autosave.isIdle()) remote.current(r);
      } catch {
        /* presence is best-effort; saving has its own error handling */
      }
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(id);
      api.leave(docId).catch(() => {});
    };
  }, [docId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return others;
}

function SaveStatus({ status }) {
  if (status === 'unsaved' || status === 'saving')
    return (
      <span className="save-status saving" aria-live="polite">
        <span className="spinner" aria-hidden /> Saving…
      </span>
    );
  if (status === 'saved')
    return (
      <span className="save-status saved" aria-live="polite">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path
            d="M3 8.5l3.2 3L13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Saved
      </span>
    );
  if (status === 'error')
    return (
      <span className="save-status error-text" aria-live="polite">
        Can't reach the server, retrying…
      </span>
    );
  return <span className="save-status" />;
}

const COLORS = ['#e8590c', '#2b8a3e', '#7048e8', '#c2255c', '#1971c2', '#5c940d'];
function Presence({ users }) {
  if (!users.length) return null;
  const typing = users.filter((u) => u.typing);
  return (
    <div className="presence" aria-label="People viewing this document">
      <div className="presence-avatars">
        {users.map((u) => (
          <span
            key={u.id}
            className={`avatar presence-avatar ${u.typing ? 'typing' : ''}`}
            style={{ background: COLORS[u.id % COLORS.length] }}
            title={`${u.name} ${u.typing ? 'is typing…' : 'is viewing'}`}
          >
            {u.name[0]}
          </span>
        ))}
      </div>
      <span className="small muted presence-text">
        {typing.length
          ? `${typing.map((u) => u.name.split(' ')[0]).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`
          : `${users.length} other${users.length > 1 ? 's' : ''} here`}
      </span>
    </div>
  );
}

export default function EditorPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [shares, setShares] = useState([]);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState('');
  const [conflict, setConflict] = useState(null); // { latest, message }
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const canEdit = doc && (doc.role === 'owner' || doc.role === 'editor');

  const onSaved = useCallback((d) => setDoc((prev) => ({ ...prev, ...d, content: undefined })), []);
  const onConflict = useCallback((latest, message) => setConflict({ latest, message }), []);
  const autosave = useAutosave(id, { onSaved, onConflict });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TextStyle,
      FontFamily,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    editable: false,
    onUpdate: ({ editor: e }) => {
      if (!e.isEditable) return;
      autosave.queue({ content: e.getHTML() });
    },
  });

  const applyServerDoc = useCallback(
    (d, { keepSelection = false } = {}) => {
      setDoc(d);
      setTitle(d.title);
      autosave.reset(d.version);
      if (!editor) return;
      const { from, to } = editor.state.selection;
      editor.commands.setContent(d.content || '', { emitUpdate: false });
      if (keepSelection) {
        const max = editor.state.doc.content.size;
        editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      }
      editor.setEditable(d.role === 'owner' || d.role === 'editor', false); // false = don't emit an update (would trigger a save)
    },
    [editor, autosave.reset], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoadError('');
    api
      .getDoc(id)
      .then((r) => {
        if (cancelled) return;
        applyServerDoc(r.document);
        setShares(r.shares || []);
      })
      .catch(
        (e) =>
          !cancelled &&
          setLoadError(e.status === 404 ? "This document doesn't exist or hasn't been shared with you." : e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [id, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone else saved and we have no unsaved edits: pull their version in place.
  const onRemoteChange = useCallback(
    async (info) => {
      try {
        const { document } = await api.getDoc(id);
        if (!autosave.isIdle()) return; // user started typing meanwhile; the 409 flow will handle it
        applyServerDoc(document, { keepSelection: true });
        flash(`Updated with ${info.updated_by_name || 'someone'}'s changes`);
      } catch {
        /* next heartbeat retries */
      }
    },
    [id, applyServerDoc], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const others = usePresence(id, Boolean(doc), autosave, onRemoteChange);

  const noticeTimer = useRef(null);
  function flash(text) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  }

  function commitTitle() {
    const next = title.trim();
    if (!next) return setTitle(doc.title); // empty titles are rejected; restore
    if (next !== doc.title) autosave.queue({ title: next }, { immediate: true });
  }

  function resolveConflict(keepMine) {
    const { latest } = conflict;
    if (keepMine && latest) {
      // Re-apply our edits on top of the latest version (explicit, user-chosen overwrite).
      const mine = autosave.pending.current;
      autosave.reset(latest.version);
      autosave.queue(mine, { immediate: true });
    } else if (latest) {
      applyServerDoc(latest);
    } else {
      window.location.reload();
      return;
    }
    setConflict(null);
  }

  function onExport(kind) {
    const html = editor?.getHTML() ?? '';
    if (kind === 'md') downloadMarkdown(title || doc.title, html);
    else exportPdf(title || doc.title);
  }

  if (loadError) {
    return (
      <>
        <Header />
        <div className="center stack">
          <p className="error">{loadError}</p>
          <Link to="/" className="btn">
            Back to documents
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header>
        {doc && (
          <div className="doc-header">
            <input
              className="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              readOnly={!canEdit}
              maxLength={200}
              aria-label="Document title"
            />
            {canEdit && <SaveStatus status={autosave.status} />}
            <span className="spacer" />
            <Presence users={others} />
            <button className={`btn ghost ${historyOpen ? 'active' : ''}`} onClick={() => setHistoryOpen((o) => !o)}>
              History
            </button>
            <Dropdown
              className="export-menu"
              label="Export"
              align="right"
              value={null}
              onChange={onExport}
              options={[
                { value: 'md', label: 'Markdown (.md)' },
                { value: 'pdf', label: 'PDF', hint: 'opens print → Save as PDF' },
              ]}
            />
            {doc.role === 'owner' ? (
              <button className="btn primary" onClick={() => setShareOpen(true)}>
                Share{shares.length ? ` · ${shares.length}` : ''}
              </button>
            ) : (
              <span className={`badge ${doc.role}`}>
                {doc.role === 'editor' ? 'Can edit' : 'View only'} · shared by {doc.owner_name}
              </span>
            )}
          </div>
        )}
      </Header>

      {conflict && (
        <div className="banner warn" role="alert">
          {conflict.latest ? (
            <>
              <span>
                {conflict.latest.updated_by_name || 'Someone else'} saved this document while you were editing.
              </span>
              <button className="btn small" onClick={() => resolveConflict(false)}>
                Load their version
              </button>
              <button className="btn small" onClick={() => resolveConflict(true)}>
                Keep mine (overwrite)
              </button>
            </>
          ) : (
            <>
              <span>{conflict.message}</span>
              <button className="btn small" onClick={() => resolveConflict(false)}>
                Reload
              </button>
            </>
          )}
        </div>
      )}
      {doc && !canEdit && (
        <div className="banner info">You have view-only access. Ask {doc.owner_name} for edit access.</div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      <div className={`editor-layout ${historyOpen ? 'with-panel' : ''}`}>
        <main className="editor-shell">
          {editor && canEdit && <Toolbar editor={editor} />}
          <div className="page">
            {!doc && <p className="muted">Loading…</p>}
            <EditorContent editor={editor} className="prose" />
          </div>
        </main>
        {historyOpen && doc && (
          <HistoryPanel
            docId={doc.id}
            canRestore={canEdit}
            restoreBlocked={autosave.status === 'unsaved' || autosave.status === 'saving'}
            refreshKey={doc.version}
            onClose={() => setHistoryOpen(false)}
            onRestored={(d) => {
              applyServerDoc(d);
              flash('Version restored');
            }}
          />
        )}
      </div>

      {shareOpen && (
        <ShareDialog
          docId={doc.id}
          title={doc.title}
          initialShares={shares}
          onChange={setShares}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  );
}
