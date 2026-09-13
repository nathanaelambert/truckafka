import { useStore } from '../store';

export function Navbar() {
  const { page, setPage, user, logout } = useStore();

  return (
    <nav className="navbar">
      <div className="navbar-brand">TRUCKMAFIA</div>
      <div className="navbar-tabs">
        <button
          className={`navbar-tab ${page === 'monitor' ? 'active' : ''}`}
          onClick={() => setPage('monitor')}
        >
          Monitor
        </button>
        {(user?.role === 'admin' || user?.role === 'dispatcher') && (
          <button
            className={`navbar-tab ${page === 'admin' ? 'active' : ''}`}
            onClick={() => setPage('admin')}
          >
            Admin
          </button>
        )}
      </div>
      <div className="navbar-spacer" />
      <div className="navbar-user">
        {user?.name} ({user?.role})
        <button onClick={logout}>Logout</button>
      </div>
    </nav>
  );
}
