import { NextResponse } from "next/server";
import { getClientWithKey } from "@/src/lib/clients-store";
import { LgmApiError, lgmRequest } from "@/src/lib/lgm-api";
import { currentUser, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;
type SearchResponse = { data?: unknown[]; total?: number | null; hasMore?: boolean; nextToken?: string | null };
type MessagesResponse = { data?: Array<{ channel?: string; status?: string; direction?: string; content?: string; createdAt?: string }> };
type LeadResponse = { lead?: AnyRecord };

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? value as AnyRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function classifyReferral(message: string): "referral" | "none" | "review" {
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

export async function GET(request: Request, context: { params: Promise<{ clientId: string; campaignId: string }> }) {
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  const { clientId, campaignId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(campaignId)) return NextResponse.json({ error: "Invalid campaign id." }, { status: 400 });

  try {
    const client = await getClientWithKey(clientId);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const query = new URL(request.url).searchParams;
    const search = new URLSearchParams({
      campaignIds: campaignId,
      leadReplied: "true",
      lastMessageType: "LINKEDIN",
      limit: "25",
    });
    const from = Number(query.get("from"));
    const toRaw = query.get("to");
    const to = Number(toRaw);
    if (query.has("from") && Number.isFinite(from)) search.set("lastMessageAtFrom", String(from));
    if (toRaw && Number.isFinite(to)) search.set("lastMessageAtTo", String(to));
    const cursor = query.get("cursor");
    if (cursor) search.set("searchAfter", cursor);

    const found = await lgmRequest<SearchResponse>(client.apiKey, `/conversations/search?${search.toString()}`);
    const conversations = Array.isArray(found.data) ? found.data : [];

    const replies = await mapLimit(conversations, 5, async (item) => {
      const match = record(item);
      const lead = record(match.lead);
      const conversationId = text(match.conversationId) || text(match.id) || text(match._id);
      const leadId = text(match.leadId) || text(lead.id) || text(lead._id);
      if (!conversationId || !leadId) return null;

      const [messageResult, leadResult] = await Promise.all([
        lgmRequest<MessagesResponse>(client.apiKey, `/conversations/${encodeURIComponent(conversationId)}/messages`),
        lgmRequest<LeadResponse>(client.apiKey, `/leads/search?leadId=${encodeURIComponent(leadId)}`),
      ]);

      const messages = Array.isArray(messageResult.data) ? messageResult.data : [];
      const latestReply = messages.slice().reverse().find((message) =>
        message.channel?.toUpperCase() === "LINKEDIN" &&
        message.status?.toUpperCase() === "RECEIVED"
      );
      if (!latestReply) return null;
      const replyTime = Date.parse(latestReply.createdAt ?? "");
      if (Number.isFinite(from) && query.has("from") && replyTime < from) return null;
      if (Number.isFinite(to) && toRaw && replyTime > to) return null;

      const profile = record(leadResult.lead);
      const firstName = text(profile.firstname) || text(profile.firstName) || text(lead.firstname) || text(lead.firstName);
      const lastName = text(profile.lastname) || text(profile.lastName) || text(lead.lastname) || text(lead.lastName);
      const message = text(latestReply.content);
      return {
        id: conversationId,
        leadId,
        name: [firstName, lastName].filter(Boolean).join(" ") || "LinkedIn lead",
        company: text(profile.companyName) || text(lead.companyName),
        jobTitle: text(profile.jobTitle) || text(lead.jobTitle),
        linkedinUrl: text(profile.linkedinUrl) || text(lead.linkedinUrl),
        message,
        createdAt: latestReply.createdAt ?? null,
        referralSignal: classifyReferral(message),
      };
    });

    return NextResponse.json({
      replies: replies.filter((reply): reply is NonNullable<typeof reply> => reply !== null),
      total: Number(found.total) || 0,
      hasMore: Boolean(found.hasMore),
      nextCursor: found.nextToken || null,
    });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "LinkedIn replies could not be loaded." }, { status: 500 });
  }
}
