import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Header({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Navigate first so the next user doesn't land on the previous user's document.
  const signOut = async () => {
    navigate('/login', { replace: true });
    await logout();
  };
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="logo" />
        Ajaia Docs
      </Link>
      <div className="topbar-middle">{children}</div>
      <div className="user">
        <span className="avatar" title={user.email}>
          {user.name[0]}
        </span>
        <span className="small">{user.name}</span>
        <button className="btn ghost small" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
