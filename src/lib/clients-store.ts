import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ClientRecord = {
  id: string;
  name: string;
  encryptedApiKey: string;
  createdAt: string;
  updatedAt: string;
};

export type SafeClient = Omit<ClientRecord, "encryptedApiKey"> & { hasApiKey: true };

const filePath = path.join(process.cwd(), "data", "clients.json");
let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionKey() {
  const raw = process.env.LGM_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("Encryption is not configured on this server.");
  }
  return Buffer.from(raw, "hex");
}

function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptApiKey(value: string) {
  const [iv, authTag, encrypted] = value.split(".");
  if (!iv || !authTag || !encrypted) throw new Error("The saved API key could not be read.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

async function readStore(): Promise<ClientRecord[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Client storage has an invalid format.");
    return parsed as ClientRecord[];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(clients: ClientRecord[]) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(clients, null, 2), { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function serializeMutation<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function safeClient({ encryptedApiKey: _encryptedApiKey, ...client }: ClientRecord): SafeClient {
  return { ...client, hasApiKey: true };
}

export async function listClients() {
  return (await readStore()).map(safeClient);
}

export async function getClientWithKey(id: string) {
  const client = (await readStore()).find((item) => item.id === id);
  if (!client) return null;
  return { ...safeClient(client), apiKey: decryptApiKey(client.encryptedApiKey) };
}

export async function createClient(name: string, apiKey: string) {
  return serializeMutation(async () => {
    const clients = await readStore();
    const now = new Date().toISOString();
    const record: ClientRecord = {
      id: randomUUID(),
      name,
      encryptedApiKey: encryptApiKey(apiKey),
      createdAt: now,
      updatedAt: now,
    };
    await writeStore([...clients, record]);
    return safeClient(record);
  });
}

export async function updateClient(id: string, updates: { name: string; apiKey?: string }) {
  return serializeMutation(async () => {
    const clients = await readStore();
    const index = clients.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = clients[index];
    const updated: ClientRecord = {
      ...current,
      name: updates.name,
      ...(updates.apiKey ? { encryptedApiKey: encryptApiKey(updates.apiKey) } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next = [...clients];
    next[index] = updated;
    await writeStore(next);
    return safeClient(updated);
  });
}
