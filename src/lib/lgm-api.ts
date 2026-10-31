import { createHash } from "node:crypto";

const LGM_BASE_URL = "https://apiv2.lagrowthmachine.com/flow";
const REQUEST_SPACING_MS = 550; // 110 requests/minute, leaving headroom under LGM's 120/minute endpoint limit.
const CAMPAIGN_CACHE_TTL_MS = 60_000;

type RequestBucket = {
  chain: Promise<void>;
  nextAllowedAt: number;
  blockedUntil: number;
};
type CampaignCacheEntry = { expiresAt: number; value: unknown };

type LgmGlobal = typeof globalThis & {
  __lgmRequestBuckets?: Map<string, RequestBucket>;
  __lgmCampaignCache?: Map<string, CampaignCacheEntry>;
};
const globalForLgm = globalThis as LgmGlobal;
const requestBuckets = globalForLgm.__lgmRequestBuckets ??= new Map<string, RequestBucket>();
const campaignCache = globalForLgm.__lgmCampaignCache ??= new Map<string, CampaignCacheEntry>();

function fingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

function bucketFor(account: string, endpoint: string): RequestBucket {
  const method = "GET";
  const path = endpoint.split("?", 1)[0].replace(/\/[a-f\d]{24}(?=\/|$)/gi, "/:id");
  const key = `${account}:${method}:${path}`;
  let bucket = requestBuckets.get(key);
  if (!bucket) {
    bucket = { chain: Promise.resolve(), nextAllowedAt: 0, blockedUntil: 0 };
    requestBuckets.set(key, bucket);
  }
  return bucket;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function retryAfterMs(header: string | null, body: unknown) {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  }
  if (body && typeof body === "object" && "retryAfter" in body) {
    const seconds = Number((body as { retryAfter?: unknown }).retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  // If LGM omits the retry delay, wait a full minute before trying that endpoint again.
  return 60_000;
}

export class LgmApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "LgmApiError";
  }
}

export async function lgmRequest<T>(apiKey: string, endpoint: string): Promise<T> {
  const account = fingerprint(apiKey);
  const bucket = bucketFor(account, endpoint);
  const cacheKey = endpoint.split("?", 1)[0] === "/campaigns" ? `${account}:GET:${endpoint}` : null;
  const request = bucket.chain.then(async () => {
    if (cacheKey) {
      const cached = campaignCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value) as T;
      if (cached) campaignCache.delete(cacheKey);
    }

    await wait(Math.max(bucket.nextAllowedAt, bucket.blockedUntil) - Date.now());
    bucket.nextAllowedAt = Date.now() + REQUEST_SPACING_MS;

    let response: Response;
    try {
      response = await fetch(`${LGM_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new LgmApiError("La Growth Machine could not be reached. Check your connection and try again.", 502);
    }

    if (response.status === 429) {
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      const delay = retryAfterMs(response.headers.get("Retry-After"), body);
      bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + delay);
      const seconds = Math.ceil(delay / 1000);
      throw new LgmApiError(`La Growth Machine rate limit reached. Please wait about ${seconds} seconds before refreshing.`, 429, seconds);
    }

    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "La Growth Machine rejected the request. Check the API details and try again.",
        401: "This API key was not accepted. Edit the client and enter a valid key.",
        403: "This API key does not have access to the requested workspace.",
        404: "La Growth Machine could not find that campaign.",
        500: "La Growth Machine encountered an error. Try again shortly.",
      };
      throw new LgmApiError(messages[response.status] ?? `La Growth Machine returned an error (${response.status}).`, response.status);
    }

    try {
      const data = (await response.json()) as T;
      if (cacheKey) campaignCache.set(cacheKey, { expiresAt: Date.now() + CAMPAIGN_CACHE_TTL_MS, value: structuredClone(data) });
      return data;
    } catch {
      throw new LgmApiError("La Growth Machine returned a response the dashboard could not read.", 502);
    }
  });

  // Keep the per-endpoint queue alive after failures so a single error cannot break later requests.
  bucket.chain = request.then(() => undefined, () => undefined);
  return request;
}

export type Campaign = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  channels?: string[];
  leadsCount?: number;
  replyRatePercent?: number;
  launchedAt?: number | null;
  createdAt?: number;
  identity?: { id?: string; firstname?: string; lastname?: string; profilePicture?: string | null } | null;
};

export type CampaignListResponse = { campaigns: Campaign[]; total: number; statusCode?: number };

export async function listCampaigns(apiKey: string, scope: "active" | "inactive" = "active") {
  const campaigns: Campaign[] = [];
  let skip = 0;
  let total = Number.POSITIVE_INFINITY;
  const statuses = scope === "active" ? ["RUNNING"] : ["PAUSED", "READY", "CANCELED"];

  while (skip < total) {
    const params = new URLSearchParams({ skip: String(skip), limit: "25", status: statuses.join(",") });
    const page = await lgmRequest<CampaignListResponse>(apiKey, `/campaigns?${params.toString()}`);
    if (!Array.isArray(page.campaigns)) throw new LgmApiError("La Growth Machine returned an unexpected campaign list.", 502);
    campaigns.push(...page.campaigns.filter((campaign) => statuses.includes(campaign.status?.toUpperCase() ?? "")));
    total = Number(page.total) || 0;
    if (page.campaigns.length === 0) break;
    skip += page.campaigns.length;
    if (skip > 25_000) throw new LgmApiError("This account has an unusually large campaign list. Narrow the list in La Growth Machine and refresh.", 502);
  }

  return { campaigns, total: Number.isFinite(total) ? total : campaigns.length };
}
