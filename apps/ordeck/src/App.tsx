import { useState } from 'react';
import BootSequence from './components/BootSequence';
import AuthGuard from './components/AuthGuard';
import Dashboard from './pages/Dashboard';

export default function App() {
  const [booted, setBooted] = useState(false);

  return (
    <>
      <BootSequence onDone={() => setBooted(true)} />
      {booted && (
        <AuthGuard>
          <Dashboard />
        </AuthGuard>
      )}
    </>
  );
}
