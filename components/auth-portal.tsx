"use client";

import { FormEvent, useState } from "react";

export type AppUser = { id: string; email: string; role: "admin" | "member"; createdAt: string };
export type AuthScreenMode = "loading" | "setup" | "setup-blocked" | "login" | "invite";

export function AuthPortal({
  mode,
  inviteToken,
  invitedEmail,
  setupSecretRequired = false,
  errorMessage,
  onComplete,
}: {
  mode: AuthScreenMode;
  inviteToken?: string;
  invitedEmail?: string;
  setupSecretRequired?: boolean;
  errorMessage?: string;
  onComplete?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode !== "login" && password !== confirmPassword) {
      setError("Those passwords do not match.");
      return;
    }
    setSubmitting(true);
    const route = mode === "setup" ? "/api/auth/setup" : mode === "invite" ? "/api/auth/accept-invitation" : "/api/auth/login";
    const body = mode === "invite"
      ? { token: inviteToken, password }
      : { email, password, ...(setupSecretRequired ? { setupSecret } : {}) };
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That request could not be completed.");
      onComplete?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That request could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  const heading = mode === "setup" ? "Create the administrator account" : mode === "invite" ? "Set your password" : "Sign in to your workspace";
  const description = mode === "setup"
    ? "The first account becomes the administrator. You can invite teammates after setup."
    : mode === "invite"
      ? "Choose a password for your Lagrowth Machine Tracker account. This invitation can be used once."
      : "Enter your email and password to open campaign analytics.";

  return (
    <main className="auth-page">
      <div className="auth-backdrop auth-backdrop-one" />
      <div className="auth-backdrop auth-backdrop-two" />
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><b>Lagrowth Machine Tracker</b><small>CAMPAIGN ANALYTICS</small></div>
        </header>
        {mode === "loading" ? <div className="auth-loading"><span className="spinner" /> Checking secure sign-in…</div> : mode === "setup-blocked" ? <>
          <span className="eyebrow">FIRST-TIME SETUP</span>
          <h1 id="auth-title">Administrator setup is locked</h1>
          <p className="auth-description">The first administrator account is not ready to be created yet. Ask the administrator to finish setup.</p>
          {errorMessage && <div className="form-error" role="alert">{errorMessage}</div>}
        </> : <>
          <span className="eyebrow">{mode === "setup" ? "FIRST-TIME SETUP" : mode === "invite" ? "TEAM INVITATION" : "PRIVATE WORKSPACE"}</span>
          <h1 id="auth-title">{heading}</h1>
          <p className="auth-description">{description}</p>
          {mode === "invite" && invitedEmail && <div className="invited-account"><span>INVITED ACCOUNT</span><b>{invitedEmail}</b></div>}
          <form className="auth-form" onSubmit={submit}>
            {mode !== "invite" && <>
              <label className="field-label" htmlFor="auth-email">Email address</label>
              <input id="auth-email" className="text-field" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
            </>}
            {mode === "setup" && setupSecretRequired && <>
              <label className="field-label auth-extra-label" htmlFor="setup-secret">One-time setup code</label>
              <input id="setup-secret" className="text-field" type="password" autoComplete="off" value={setupSecret} onChange={(event) => setSetupSecret(event.target.value)} required />
            </>}
            <label className={`field-label ${mode === "setup" || mode === "invite" ? "auth-extra-label" : ""}`} htmlFor="auth-password">{mode === "setup" || mode === "invite" ? "Create a password" : "Password"}</label>
            <input id="auth-password" className="text-field" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "Enter your password" : "At least 12 characters"} required />
            {(mode === "setup" || mode === "invite") && <>
              <label className="field-label auth-extra-label" htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" className="text-field" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter it again" required />
              <p className="password-note">Use 12 or more characters. A long phrase is easy to remember and hard to guess.</p>
            </>}
            {(error || errorMessage) && <div className="form-error" role="alert">{error || errorMessage}</div>}
            <button className="button primary auth-submit" disabled={submitting}>
              {submitting ? <><span className="spinner small" /> Working…</> : mode === "setup" ? "Create administrator account" : mode === "invite" ? "Set password and continue" : "Sign in"}
            </button>
          </form>
          {mode === "login" && <p className="auth-footnote">Access is by invitation only. Contact your administrator if you need an account.</p>}
        </>}
      </section>
      <p className="auth-security-note">Passwords are protected with one-way hashing.</p>
    </main>
  );
}
