import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AccountRole = "admin" | "member";

export type AuthUser = {
  id: string;
  email: string;
  role: AccountRole;
  passwordHash: string;
  createdAt: string;
};

export type PublicUser = Pick<AuthUser, "id" | "email" | "role" | "createdAt">;

type Invitation = {
  id: string;
  email: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
};

type Session = { tokenHash: string; userId: string; expiresAt: string };
type AuthData = { users: AuthUser[]; invitations: Invitation[]; sessions: Session[] };
type PendingInvitation = Pick<Invitation, "id" | "email" | "createdAt" | "expiresAt">;

const filePath = path.join(process.cwd(), "data", "auth.json");
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 1 << 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
let writeQueue: Promise<unknown> = Promise.resolve();

function emptyData(): AuthData {
  return { users: [], invitations: [], sessions: [] };
}

async function readStore(): Promise<AuthData> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Account storage has an invalid format.");
    const data = parsed as Partial<AuthData>;
    if (!Array.isArray(data.users) || !Array.isArray(data.invitations) || !Array.isArray(data.sessions)) {
      throw new Error("Account storage has an invalid format.");
    }
    return data as AuthData;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyData();
    throw error;
  }
}

async function writeStore(data: AuthData) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function serializeMutation<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function toPublicUser({ id, email, role, createdAt }: AuthUser): PublicUser {
  return { id, email, role, createdAt };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string) {
  const length = [...password].length;
  return length >= 12 && length <= 128;
}

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 256 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltText, digestText] = encoded.split("$");
  if (algorithm !== "scrypt" || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P || !saltText || !digestText) return false;
  try {
    const expected = Buffer.from(digestText, "base64url");
    const actual = await derivePassword(password, Buffer.from(saltText, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    record: {
      tokenHash: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
    },
  };
}

export async function getSetupStatus() {
  const data = await readStore();
  return { setupRequired: data.users.length === 0 };
}

export async function getInvitationDetails(token: string | null) {
  if (!token || token.length > 200) return null;
  const hash = tokenHash(token);
  const invitation = (await readStore()).invitations.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
  return invitation ? { email: invitation.email, expiresAt: invitation.expiresAt } : null;
}

export async function createFirstAdmin(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
  if (!validatePassword(password)) throw new Error("Use a password between 12 and 128 characters.");
  const passwordHash = await hashPassword(password);

  return serializeMutation(async () => {
    const data = await readStore();
    if (data.users.length > 0) throw new Error("The first administrator has already been set up.");
    const user: AuthUser = { id: randomUUID(), email, role: "admin", passwordHash, createdAt: new Date().toISOString() };
    const session = makeSession(user.id);
    await writeStore({ ...data, users: [user], sessions: [session.record] });
    return { user: toPublicUser(user), sessionToken: session.token };
  });
}

export async function signIn(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const data = await readStore();
  const user = data.users.find((item) => item.email === email);
  if (!user) {
    await derivePassword(password, Buffer.from("lagrowth-machine-tracker-login-dummy-salt"));
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return serializeMutation(async () => {
    const current = await readStore();
    const stillActive = current.users.find((item) => item.id === user.id);
    if (!stillActive) return null;
    const session = makeSession(stillActive.id);
    const now = Date.now();
    const sessions = current.sessions.filter((item) => Date.parse(item.expiresAt) > now);
    await writeStore({ ...current, sessions: [...sessions, session.record] });
    return { user: toPublicUser(stillActive), sessionToken: session.token };
  });
}

export async function getUserForSession(token: string | null | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const data = await readStore();
  const session = data.sessions.find((item) => item.tokenHash === tokenHash(token) && Date.parse(item.expiresAt) > Date.now());
  if (!session) return null;
  const user = data.users.find((item) => item.id === session.userId);
  return user ? toPublicUser(user) : null;
}

export async function endSession(token: string | null | undefined) {
  if (!token) return;
  const hash = tokenHash(token);
  await serializeMutation(async () => {
    const data = await readStore();
    await writeStore({ ...data, sessions: data.sessions.filter((item) => item.tokenHash !== hash) });
  });
}

export async function createInvitation(emailInput: string, createdBy: string) {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
  const token = randomBytes(32).toString("base64url");

  return serializeMutation(async () => {
    const data = await readStore();
    if (data.users.some((item) => item.email === email)) throw new Error("That email already has an account.");
    const now = new Date();
    const invitation: Invitation = {
      id: randomUUID(),
      email,
      tokenHash: tokenHash(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString(),
      createdBy,
    };
    const invitations = data.invitations.filter((item) => item.email !== email && Date.parse(item.expiresAt) > now.getTime());
    await writeStore({ ...data, invitations: [...invitations, invitation] });
    return { invitation: { id: invitation.id, email, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt }, token };
  });
}

export async function acceptInvitation(token: string, password: string) {
  if (!token || token.length > 200) throw new Error("This invitation link is invalid or has expired.");
  if (!validatePassword(password)) throw new Error("Use a password between 12 and 128 characters.");
  const hash = tokenHash(token);
  const initial = await readStore();
  const invite = initial.invitations.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
  if (!invite) throw new Error("This invitation link is invalid or has expired. Ask the administrator for a new one.");
  const passwordHash = await hashPassword(password);

  return serializeMutation(async () => {
    const data = await readStore();
    const currentInvite = data.invitations.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
    if (!currentInvite) throw new Error("This invitation link has already been used or has expired.");
    if (data.users.some((item) => item.email === currentInvite.email)) throw new Error("That email already has an account.");
    const user: AuthUser = {
      id: randomUUID(),
      email: currentInvite.email,
      role: "member",
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    const session = makeSession(user.id);
    await writeStore({
      ...data,
      users: [...data.users, user],
      invitations: data.invitations.filter((item) => item.id !== currentInvite.id),
      sessions: [...data.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now()), session.record],
    });
    return { user: toPublicUser(user), sessionToken: session.token };
  });
}

export async function listTeam() {
  const data = await readStore();
  const now = Date.now();
  const users = data.users.map(toPublicUser);
  const invitations: PendingInvitation[] = data.invitations
    .filter((item) => Date.parse(item.expiresAt) > now)
    .map(({ id, email, createdAt, expiresAt }) => ({ id, email, createdAt, expiresAt }));
  return { users, invitations };
}

export async function revokeInvitation(id: string) {
  return serializeMutation(async () => {
    const data = await readStore();
    const invitations = data.invitations.filter((item) => item.id !== id);
    if (invitations.length === data.invitations.length) return false;
    await writeStore({ ...data, invitations });
    return true;
  });
}
