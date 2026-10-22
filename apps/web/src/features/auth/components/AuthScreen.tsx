"use client";
import type { FormEvent } from "react";
export function AuthScreen({
  signup,
  setSignup,
  setError,
  setNotice,
  error,
  notice,
  auth,
  busy,
}: {
  signup: boolean;
  setSignup: (v: boolean) => void;
  setError: (v: string) => void;
  setNotice: (v: string) => void;
  error: string;
  notice: string;
  auth: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>PAW</h1>
        <p>{signup ? "Create your account." : "Welcome back."}</p>
        <div className="auth-modes">
          <button
            className={!signup ? "primary" : ""}
            onClick={() => {
              setSignup(false);
              setError("");
              setNotice("");
            }}
          >
            Sign in
          </button>
          <button
            className={signup ? "primary" : ""}
            onClick={() => {
              setSignup(true);
              setError("");
              setNotice("");
            }}
          >
            Sign up
          </button>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        <form onSubmit={auth}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={signup ? "new-password" : "current-password"}
              required
              placeholder="At least 8 characters"
            />
          </label>
          <button disabled={busy} className="primary">
            {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
