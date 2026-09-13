import { useEffect } from 'react';
import { useStore } from './store';
import { Navbar } from './components/Navbar';
import { Monitor } from './pages/Monitor';
import { Admin } from './pages/Admin';
import { Login } from './pages/Login';

export function App() {
  const { isAuthenticated, page, initWebSocket, refreshAll } = useStore();

  useEffect(() => {
    if (isAuthenticated) {
      initWebSocket();
      refreshAll();
    }
  }, [isAuthenticated, initWebSocket, refreshAll]);

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <>
      <Navbar />
      {page === 'monitor' && <Monitor />}
      {page === 'admin' && <Admin />}
    </>
  );
}
