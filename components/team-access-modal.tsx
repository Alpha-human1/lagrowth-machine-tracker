"use client";

import { FormEvent, useEffect, useState } from "react";

type TeamUser = { id: string; email: string; role: "admin" | "member"; createdAt: string };
type PendingInvite = { id: string; email: string; createdAt: string; expiresAt: string };

function displayDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function TeamAccessModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refreshTeam() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/invitations", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Team access could not be loaded.");
      setUsers(data.users as TeamUser[]);
      setInvitations(data.invitations as PendingInvite[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Team access could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshTeam();
  }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    setInviteUrl("");
    try {
      const response = await fetch("/api/auth/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invitation could not be created.");
      setInviteUrl(data.inviteUrl as string);
      setEmail("");
      setNotice(`Invitation link created for ${data.invitation.email}. Share the link with that person.`);
      await refreshTeam();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invitation could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("Invitation link copied. Send it directly to the invited person.");
    } catch {
      setError("Copy was unavailable. Select the invitation link and copy it manually.");
    }
  }

  async function revoke(invitation: PendingInvite) {
    setError("");
    try {
      const response = await fetch(`/api/auth/invitations/${invitation.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invitation could not be removed.");
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      setNotice(`Invitation for ${invitation.email} was canceled.`);
      setInviteUrl("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invitation could not be removed.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="client-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
        <div className="modal-head">
          <div><span className="eyebrow">WORKSPACE ACCESS</span><h2 id="team-modal-title">Team access</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}><span aria-hidden="true">×</span></button>
        </div>
        <p className="team-intro">Invite people by email. Teammates can view the shared campaigns; only you can add clients and manage access.</p>
        <form className="invite-form" onSubmit={invite}>
          <label className="field-label" htmlFor="invite-email">Email address</label>
          <div className="invite-entry"><input id="invite-email" className="text-field" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" required /><button className="button primary" disabled={submitting || !email.trim()}>{submitting ? "Creating…" : "Create invite"}</button></div>
        </form>
        {inviteUrl && <div className="invite-link-card"><div><b>Share this one-time link</b><span>It expires in 7 days. The recipient will set their own password.</span></div><div className="invite-link-row"><input className="text-field" readOnly aria-label="Invitation link" value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button outline" onClick={() => void copyLink()}>Copy link</button></div></div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        {notice && <div className="team-notice" role="status">{notice}</div>}
        <div className="team-list-heading"><b>People with access</b><span>{users.length} {users.length === 1 ? "person" : "people"}</span></div>
        {loading ? <div className="team-loading"><span className="spinner small" /> Loading people…</div> : <div className="team-list">
          {users.map((user) => <div className="team-person" key={user.id}><span className="team-avatar">{user.email.slice(0, 1).toUpperCase()}</span><div><b>{user.email}</b><small>Added {displayDate(user.createdAt)}</small></div><span className={`role-label ${user.role}`}>{user.role === "admin" ? "Admin" : "Member"}</span></div>)}
          {invitations.map((invitation) => <div className="team-person pending-person" key={invitation.id}><span className="team-avatar pending-avatar">…</span><div><b>{invitation.email}</b><small>Invite expires {displayDate(invitation.expiresAt)}</small></div><span className="role-label pending">Pending</span><button className="button quiet revoke-invite" onClick={() => void revoke(invitation)}>Cancel</button></div>)}
          {!users.length && !invitations.length && <p className="team-empty">No one has access yet.</p>}
        </div>}
        <div className="modal-actions"><button type="button" className="button quiet" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}
