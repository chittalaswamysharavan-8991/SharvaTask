'use client';

import { FormEvent, useState } from 'react';

export function ControlCenterGate() {
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!accessKey.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/control-center/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_key: accessKey.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to unlock the control center.');
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to unlock the control center.');
      setBusy(false);
    }
  }

  return (
    <main className="gate-shell">
      <section className="gate-card">
        <div className="gate-mark">S</div>
        <div className="gate-copy">
          <h1>SharvaTask Control Center</h1>
          <p>Your canonical lists, tasks, proof, and history are protected. Enter the private access key to continue.</p>
        </div>
        <form onSubmit={unlock}>
          <label>
            Access key
            <input
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="Enter access key"
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <button className="primary-button" disabled={busy || !accessKey.trim()}>{busy ? 'Unlocking…' : 'Open control center'}</button>
        </form>
        {error && <div className="gate-error">{error}</div>}
        <div className="gate-status"><span className="status-dot online" />MCP and Vercel Blob remain the canonical backend</div>
      </section>
    </main>
  );
}
