import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Header from '../components/Header.jsx';
import Dropdown from '../components/Dropdown.jsx';

const ACCEPT = '.txt,.md,.docx';
const MAX_MB = 5;
const OWNER_FILTERS = [
  { value: 'any', label: 'Owned by anyone' },
  { value: 'me', label: 'Owned by me' },
  { value: 'others', label: 'Not owned by me' },
];

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DocList({ docs, emptyText, onDelete }) {
  if (!docs.length) return <p className="muted empty">{emptyText}</p>;
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={`/d/${d.id}`} className="doc-row">
            <span className="doc-icon" aria-hidden />
            <span className="doc-title">{d.title}</span>
            {d.role !== 'owner' && (
              <span className={`badge ${d.role}`}>{d.role === 'editor' ? 'Can edit' : 'View only'}</span>
            )}
            <span className="muted small doc-meta">
              {d.role === 'owner' ? 'You' : d.owner_name} · {formatDate(d.updated_at)}
            </span>
          </Link>
          {onDelete && (
            <button className="btn ghost small danger" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>
              Delete
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('any');

  const load = () =>
    api
      .listDocs()
      .then(setDocs)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function createDoc() {
    setBusy(true);
    try {
      const { document } = await api.createDoc();
      navigate(`/d/${document.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function importFile(file) {
    if (!file) return;
    setError('');
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    // Client-side checks for fast feedback; the server enforces the same rules.
    if (!ACCEPT.split(',').includes(ext))
      return setError(`"${file.name}" isn't supported. Upload a .txt, .md or .docx file.`);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`"${file.name}" is larger than ${MAX_MB} MB.`);
    setBusy(true);
    try {
      const { document } = await api.importDoc(file);
      navigate(`/d/${document.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This also removes access for everyone it's shared with.`)) return;
    try {
      await api.deleteDoc(doc.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const q = query.trim().toLowerCase();
  const matches = (d) => !q || d.title.toLowerCase().includes(q);
  const owned = docs ? docs.owned.filter(matches) : [];
  const shared = docs ? docs.shared.filter(matches) : [];
  const showOwned = owner !== 'others';
  const showShared = owner !== 'me';
  const noResults = docs && q && (!showOwned || !owned.length) && (!showShared || !shared.length);

  return (
    <>
      <Header />
      <main
        className={`dashboard ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          importFile(e.dataTransfer.files[0]);
        }}
      >
        <section className="actions">
          <button className="new-doc" onClick={createDoc} disabled={busy}>
            <span className="plus">+</span>
            <span>Blank document</span>
          </button>
          <button className="new-doc" onClick={() => fileInput.current.click()} disabled={busy}>
            <span className="plus">⇪</span>
            <span>Import a file</span>
            <span className="muted small">.txt, .md, .docx · max {MAX_MB} MB · or drop it here</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              importFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </section>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="list-controls">
          <div className="search">
            <span className="search-icon" aria-hidden>
              ⌕
            </span>
            <input
              type="search"
              placeholder="Search documents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documents by title"
            />
          </div>
          <Dropdown
            label={OWNER_FILTERS.find((f) => f.value === owner).label}
            options={OWNER_FILTERS}
            value={owner}
            onChange={setOwner}
            align="right"
            className="owner-filter"
          />
        </div>

        {docs === null ? (
          <p className="muted">Loading documents…</p>
        ) : noResults ? (
          <p className="muted empty">No documents match “{query.trim()}”.</p>
        ) : (
          <>
            {showOwned && (
              <>
                <h2>My documents</h2>
                <DocList
                  docs={owned}
                  emptyText={q ? 'No matches in your documents.' : "You haven't created any documents yet."}
                  onDelete={deleteDoc}
                />
              </>
            )}
            {showShared && (
              <>
                <h2>Shared with me</h2>
                <DocList
                  docs={shared}
                  emptyText={q ? 'No matches in shared documents.' : 'Nothing has been shared with you yet.'}
                />
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
