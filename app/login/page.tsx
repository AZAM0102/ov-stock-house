'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';

export default function LoginPage() {
  const { signIn, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    try {
      setBusy(true);
      await signIn(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand"><img src="/online-vyapari-logo.webp" alt="OV Stock House"/><div><b>OV Stock House</b><span>Inventory Manager</span></div></div>
      <div className="login-heading"><p className="eyebrow">SECURE ACCESS</p><h1>Welcome back</h1><p>Sign in to manage products, stock, orders and returns.</p></div>
      <form onSubmit={submit} className="login-form">
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@example.com" disabled={busy || loading}/></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" disabled={busy || loading}/></label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary login-button" disabled={busy || loading}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
      </form>
      <p className="login-note">Only authorized OV Stock House users should access this inventory.</p>
    </section>
  </main>;
}
