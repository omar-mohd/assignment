import { useEffect, useState } from 'react';
import { api } from '../api.js';

function when(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPanel({ docId, canRestore, restoreBlocked, refreshKey, onRestored, onClose }) {
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null); // full version incl. content
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .versions(docId)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError(e.message));
  }, [docId, refreshKey]);

  async function open(v, isCurrent) {
    if (isCurrent) return setSelected(null);
    setError('');
    try {
      setSelected({ ...(await api.getVersion(docId, v.id)).version });
    } catch (e) {
      setError(e.message);
    }
  }

  async function restore() {
    if (!window.confirm('Restore this version? The current version stays in history, so you can undo this.')) return;
    setBusy(true);
    setError('');
    try {
      const { document } = await api.restoreVersion(docId, selected.id);
      setSelected(null);
      onRestored(document);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="side-panel" aria-label="Version history">
      <div className="side-panel-head">
        <h3>Version history</h3>
        <button className="btn ghost small" onClick={onClose} aria-label="Close version history">
          ✕
        </button>
      </div>
      <p className="muted small">Edits by the same person within 10 minutes are grouped into one version.</p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {selected && (
        <div className="version-preview">
          <div className="version-preview-head">
            <div>
              <strong>{when(selected.saved_at)}</strong>
              <div className="muted small">
                {selected.author_name || 'Unknown'} · “{selected.title}”
              </div>
            </div>
            <button className="btn ghost small" onClick={() => setSelected(null)}>
              Back
            </button>
          </div>
          {/* Content was sanitized server-side on write. */}
          <div className="prose preview-body">
            <div className="tiptap" dangerouslySetInnerHTML={{ __html: selected.content || '<p><em>Empty</em></p>' }} />
          </div>
          {canRestore && (
            <button className="btn primary" disabled={busy || restoreBlocked} onClick={restore}>
              {restoreBlocked ? 'Saving your changes…' : busy ? 'Restoring…' : 'Restore this version'}
            </button>
          )}
        </div>
      )}

      {!selected && (
        <ul className="version-list">
          {versions === null && <li className="muted">Loading…</li>}
          {versions?.map((v, i) => (
            <li key={v.id}>
              <button className={`version-item ${i === 0 ? 'current' : ''}`} onClick={() => open(v, i === 0)}>
                <span className="version-time">{when(v.saved_at)}</span>
                <span className="muted small">
                  {v.author_name || 'Unknown'}
                  {v.label ? ` · ${v.label}` : ''}
                </span>
                {i === 0 && <span className="badge editor">Current version</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
