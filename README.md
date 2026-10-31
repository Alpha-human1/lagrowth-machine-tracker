# Lagrowth Machine Tracker

A private campaign analytics dashboard for La Growth Machine accounts.

## Run on this computer

1. Install Node.js 20.9 or newer.
2. From this folder, run `npm install` once.
3. Run `npm run dev` and open [http://127.0.0.1:3000](http://127.0.0.1:3000).
4. On first use, create the administrator with your email and a password of at least 12 characters. The first account is the only account that can manage the workspace.
5. Add a La Growth Machine account from the dashboard.

## Invite teammates

1. As administrator, choose **Team access** and enter the teammate's email address.
2. The dashboard creates an individual invitation link. Copy it and send it directly to that person; the app does not send email automatically.
3. The invitation expires after seven days and can only be used once. When the teammate opens it, they set their own password and are signed in as a member.
4. Members can view campaign analytics. Only the administrator can add client accounts or invite people.

The invitation link is a private, one-time credential. Send it only to the email address it was created for. Cancel a pending invitation from **Team access** if it was shared with the wrong person.

## Local data and security

- `data/auth.json` stores user emails, password hashes, pending invitation-token hashes, and session-token hashes. Passwords and live tokens are never written in plain text.
- Passwords are hashed with Node's built-in scrypt implementation and a unique random salt. Sessions use an HttpOnly, SameSite cookie and expire after 14 days.
- `data/clients.json` stores client names and encrypted API keys. The encryption key lives in `.env.local`; both files are excluded from Git.
- Back up `.env.local` and the `data/` folder together. Losing the encryption key means saved La Growth Machine keys must be connected again.

## Sharing the dashboard

The current development server binds to this computer only. A link created at `127.0.0.1` will not open on a teammate's device. To share invitations, the app must first be hosted at an HTTPS address and its data must live in persistent shared storage. Before a public deployment, move account and authentication records from local JSON files to a persistent database, preserve the API-key encryption secret in the host's secret settings, set `APP_BASE_URL` to the public HTTPS address, and set a strong `INITIAL_ADMIN_SETUP_SECRET` so only you can create the first administrator. Do not use the local JSON setup as a multi-instance production database.
