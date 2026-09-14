'use client';
import { useEffect, useState } from 'react';
import { loadInterfacePreferences, refreshInterfacePreferences } from '@/lib/client-preferences';

export function InterfacePreferences({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false;
    void loadInterfacePreferences()
      .then(() => {
        if (!closed) setReady(true);
      })
      .catch((error) => {
        if (!closed) setError(error.message);
      });
    const refresh = () => {
      void loadInterfacePreferences()
        .then(refreshInterfacePreferences)
        .catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => {
      closed = true;
      window.removeEventListener('focus', refresh);
    };
  }, [attempt]);
  if (!ready)
    return (
      <div className="session-bootstrap">
        {error ? (
          <>
            <p role="alert">Could not open your saved preferences: {error}</p>
            <button
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <p>Opening your studio…</p>
        )}
      </div>
    );
  return children;
}
