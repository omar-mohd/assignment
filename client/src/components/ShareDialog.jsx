import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ShareDialog({ docId, title, initialShares, onClose, onChange }) {
  const [shares, setShares] = useState(initialShares || []);
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .users()
      .then((r) => setUsers(r.users))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      setShares(r.shares);
      onChange?.(r.shares);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e) {
    e.preventDefault();
    if (await run(() => api.share(docId, email, role))) setEmail('');
  }

  const sharedIds = new Set(shares.map((s) => s.user_id));
  const suggestions = users.filter((u) => !sharedIds.has(u.id));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h3 id="share-title">Share “{title}”</h3>
        <form className="share-form" onSubmit={add}>
          <input
            type="email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            list="share-users"
            required
            autoFocus
          />
          <datalist id="share-users">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn primary" disabled={busy}>
            Share
          </button>
        </form>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <h4>People with access</h4>
        <ul className="share-list">
          <li>
            <span>You</span>
            <span className="muted small">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.user_id}>
              <span>
                {s.name} <span className="muted small">{s.email}</span>
              </span>
              <span className="share-actions">
                <select
                  value={s.role}
                  disabled={busy}
                  aria-label={`Access for ${s.name}`}
                  onChange={(e) => run(() => api.share(docId, s.email, e.target.value))}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  className="btn ghost small danger"
                  disabled={busy}
                  onClick={() => run(() => api.unshare(docId, s.user_id))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
