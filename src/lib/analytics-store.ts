import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AnalyticsMetrics = {
  audience: number;
  connections: number;
  linkedinReplies: number;
  emailReplies: number;
  conversions: number;
};

export type AnalyticsSnapshot = { sampledAt: number; metrics: AnalyticsMetrics; campaigns?: Record<string, AnalyticsMetrics> };

export type StoredReply = {
  id: string;
  leadId: string;
  campaignId: string;
  campaignName: string;
  channel: "LINKEDIN" | "EMAIL";
  name: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  message: string;
  createdAt: string;
  referralSignal: "referral" | "none" | "review";
};

type AnalyticsStore = {
  snapshots: Record<string, AnalyticsSnapshot[]>;
  replies: Record<string, StoredReply[]>;
};

const filePath = path.join(process.cwd(), "data", "analytics.json");
let writeQueue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<AnalyticsStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Analytics storage has an invalid format.");
    const value = parsed as Partial<AnalyticsStore>;
    return {
      snapshots: value.snapshots && typeof value.snapshots === "object" ? value.snapshots : {},
      replies: value.replies && typeof value.replies === "object" ? value.replies : {},
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { snapshots: {}, replies: {} };
    }
    throw error;
  }
}

async function writeStore(store: AnalyticsStore) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function serializeMutation<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getAnalyticsSnapshots(clientId: string) {
  const store = await readStore();
  return store.snapshots[clientId] ?? [];
}

export async function saveAnalyticsSnapshot(clientId: string, snapshot: AnalyticsSnapshot) {
  return serializeMutation(async () => {
    const store = await readStore();
    const snapshots = store.snapshots[clientId] ?? [];
    const last = snapshots.at(-1);
    // Keep a useful daily history without writing a new file entry on every refresh.
    if (!last || snapshot.sampledAt - last.sampledAt >= 6 * 60 * 60 * 1000) snapshots.push(snapshot);
    store.snapshots[clientId] = snapshots.filter((item) => item.sampledAt >= snapshot.sampledAt - 180 * 24 * 60 * 60 * 1000);
    await writeStore(store);
    return store.snapshots[clientId];
  });
}

export async function saveReplies(clientId: string, replies: StoredReply[]) {
  if (!replies.length) return;
  return serializeMutation(async () => {
    const store = await readStore();
    const current = store.replies[clientId] ?? [];
    const byId = new Map(current.map((reply) => [reply.id, reply]));
    for (const reply of replies) byId.set(reply.id, reply);
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    store.replies[clientId] = [...byId.values()]
      .filter((reply) => Date.parse(reply.createdAt) >= cutoff)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 5000);
    await writeStore(store);
  });
}

export async function getReplies(clientId: string, from: number, to: number) {
  const store = await readStore();
  return (store.replies[clientId] ?? []).filter((reply) => {
    const createdAt = Date.parse(reply.createdAt);
    return Number.isFinite(createdAt) && createdAt >= from && createdAt <= to;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
