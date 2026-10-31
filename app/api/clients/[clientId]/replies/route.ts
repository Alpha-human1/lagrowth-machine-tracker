import { NextResponse } from "next/server";
import { getReplies, saveReplies, type StoredReply } from "@/src/lib/analytics-store";
import { getClientWithKey } from "@/src/lib/clients-store";
import { listCampaigns, LgmApiError, lgmRequest } from "@/src/lib/lgm-api";
import { currentUser, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;
type SearchResponse = { data?: unknown[]; total?: number | null; hasMore?: boolean; nextToken?: string | null };
type MessagesResponse = { data?: Array<{ id?: string; channel?: string; status?: string; content?: string; createdAt?: string }> };
type LeadResponse = { lead?: AnyRecord };

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? value as AnyRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function classifyReferral(message: string): StoredReply["referralSignal"] {
  if (!message.trim()) return "review";
  const referralLanguage = /\b(referr?(?:al|ed|ing)?|recommend(?:ed|ation|ing)?|introduc(?:e|ed|tion|ing)|put you in touch|connect(?:ing)? you with|pass(?:ing)? your name|forward(?:ing)? your name)\b/i;
  const refusal = /\b(?:can't|cannot|won't|wouldn't|don't|do not|not able to|unable to|no)\b.{0,45}\b(?:refer|referral|recommend|introduc|connect you|put you in touch)\b/i;
  if (refusal.test(message)) return "none";
  return referralLanguage.test(message) ? "referral" : "none";
}

async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  const { clientId } = await context.params;

  try {
    const client = await getClientWithKey(clientId);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const query = new URL(request.url).searchParams;
    const from = Number(query.get("from"));
    const to = Number(query.get("to"));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return NextResponse.json({ error: "The selected reply date range is invalid." }, { status: 400 });
    }

    const [active, inactive] = await Promise.all([
      listCampaigns(client.apiKey, "active"),
      listCampaigns(client.apiKey, "inactive"),
    ]);
    const campaigns = [...active.campaigns, ...inactive.campaigns];
    if (!campaigns.length) return NextResponse.json({ replies: [], total: 0, hasMore: false, nextCursor: null, syncedAt: new Date().toISOString() });

    const search = new URLSearchParams({
      campaignIds: campaigns.map((campaign) => campaign.id).join(","),
      leadReplied: "true",
      lastMessageType: "EMAIL,LINKEDIN",
      lastMessageAtFrom: String(from),
      lastMessageAtTo: String(to),
      limit: "25",
    });
    const cursor = query.get("cursor");
    if (cursor) search.set("searchAfter", cursor);
    const found = await lgmRequest<SearchResponse>(client.apiKey, `/conversations/search?${search.toString()}`);
    const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
    const conversations = Array.isArray(found.data) ? found.data : [];

    const batches = await mapLimit(conversations, 5, async (item): Promise<StoredReply[]> => {
      const match = record(item);
      const lead = record(match.lead);
      const conversationId = text(match.conversationId) || text(match.id) || text(match._id);
      const leadId = text(match.leadId) || text(lead.id) || text(lead._id);
      if (!conversationId || !leadId) return [];

      const [messageResult, leadResult] = await Promise.all([
        lgmRequest<MessagesResponse>(client.apiKey, `/conversations/${encodeURIComponent(conversationId)}/messages`),
        lgmRequest<LeadResponse>(client.apiKey, `/leads/search?leadId=${encodeURIComponent(leadId)}`),
      ]);
      const profile = record(leadResult.lead);
      const firstName = text(profile.firstname) || text(profile.firstName) || text(lead.firstname) || text(lead.firstName);
      const lastName = text(profile.lastname) || text(profile.lastName) || text(lead.lastname) || text(lead.lastName);
      const campaignId = text(match.campaignId) || text(record(match.campaign).id);
      const messages = Array.isArray(messageResult.data) ? messageResult.data : [];

      return messages.flatMap((message) => {
        const channel = message.channel?.toUpperCase();
        const createdAt = message.createdAt ?? "";
        const timestamp = Date.parse(createdAt);
        if (message.status?.toUpperCase() !== "RECEIVED" || !Number.isFinite(timestamp) || timestamp < from || timestamp > to) return [];
        if (channel !== "LINKEDIN" && channel !== "EMAIL" && channel !== "GOOGLE") return [];
        const body = text(message.content);
        return [{
          id: text(message.id) || `${conversationId}:${createdAt}`,
          leadId,
          campaignId,
          campaignName: campaignNames.get(campaignId) || text(match.campaignName) || "Campaign",
          channel: channel === "LINKEDIN" ? "LINKEDIN" : "EMAIL",
          name: [firstName, lastName].filter(Boolean).join(" ") || "Campaign lead",
          company: text(profile.companyName) || text(lead.companyName),
          jobTitle: text(profile.jobTitle) || text(lead.jobTitle),
          linkedinUrl: text(profile.linkedinUrl) || text(lead.linkedinUrl),
          message: body,
          createdAt,
          referralSignal: classifyReferral(body),
        }];
      });
    });

    const freshReplies = batches.flat();
    await saveReplies(clientId, freshReplies);
    const replies = (await getReplies(clientId, from, to)).slice(0, 250);
    return NextResponse.json({
      replies,
      total: Number(found.total) || 0,
      hasMore: Boolean(found.hasMore),
      nextCursor: found.nextToken || null,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Replies could not be synced. Please try again." }, { status: 500 });
  }
}
