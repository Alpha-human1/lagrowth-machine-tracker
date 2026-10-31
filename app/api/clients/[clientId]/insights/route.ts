import { NextResponse } from "next/server";
import { getAnalyticsSnapshots, saveAnalyticsSnapshot, type AnalyticsMetrics } from "@/src/lib/analytics-store";
import { getClientWithKey } from "@/src/lib/clients-store";
import { listCampaigns, LgmApiError, lgmRequest } from "@/src/lib/lgm-api";
import { currentUser, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;
type StatsResponse = { engagementStats?: AnyRecord };

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? value as AnyRecord : {};
}

function count(...values: unknown[]) {
  const value = values.find((item) => typeof item === "number" && Number.isFinite(item));
  return typeof value === "number" ? value : 0;
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

function nearestAtOrBefore<T extends { sampledAt: number }>(snapshots: T[], target: number, maxAge: number) {
  const candidate = snapshots.filter((item) => item.sampledAt <= target).at(-1);
  return candidate && target - candidate.sampledAt <= maxAge ? candidate : null;
}

function difference(current: AnalyticsMetrics, baseline: AnalyticsMetrics): AnalyticsMetrics {
  return {
    audience: current.audience - baseline.audience,
    connections: current.connections - baseline.connections,
    linkedinReplies: current.linkedinReplies - baseline.linkedinReplies,
    emailReplies: current.emailReplies - baseline.emailReplies,
    conversions: current.conversions - baseline.conversions,
  };
}

function emptyMetrics(): AnalyticsMetrics {
  return { audience: 0, connections: 0, linkedinReplies: 0, emailReplies: 0, conversions: 0 };
}

function intervalDifference(
  laterCampaigns: Record<string, AnalyticsMetrics>,
  baseline: { sampledAt: number; campaigns?: Record<string, AnalyticsMetrics> },
  history: Array<{ sampledAt: number; campaigns?: Record<string, AnalyticsMetrics> }>,
  laterAt: number,
) {
  const total = emptyMetrics();
  for (const [campaignId, current] of Object.entries(laterCampaigns)) {
    let starting = baseline.campaigns?.[campaignId];
    if (!starting) {
      const firstTracked = history.find((snapshot) =>
        snapshot.sampledAt > baseline.sampledAt && snapshot.sampledAt <= laterAt && snapshot.campaigns?.[campaignId]
      );
      starting = firstTracked?.campaigns?.[campaignId];
    }
    // A campaign first seen in this period starts from its first saved snapshot; we do not count its earlier lifetime totals as new activity.
    if (!starting) continue;
    const delta = difference(current, starting);
    total.audience += delta.audience;
    total.connections += delta.connections;
    total.linkedinReplies += delta.linkedinReplies;
    total.emailReplies += delta.emailReplies;
    total.conversions += delta.conversions;
  }
  return total;
}

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  const { clientId } = await context.params;

  try {
    const client = await getClientWithKey(clientId);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const url = new URL(request.url);
    const period = url.searchParams.get("period") === "month" ? "month" : "week";
    const currentStart = Number(url.searchParams.get("currentStart"));
    const previousStart = Number(url.searchParams.get("previousStart"));
    if (!Number.isFinite(currentStart) || !Number.isFinite(previousStart) || previousStart >= currentStart) {
      return NextResponse.json({ error: "The selected reporting period is invalid." }, { status: 400 });
    }

    // Include paused and finished campaigns so moving a campaign out of the live list does not erase its tracked totals.
    const [active, inactive] = await Promise.all([
      listCampaigns(client.apiKey, "active"),
      listCampaigns(client.apiKey, "inactive"),
    ]);
    const campaigns = [...active.campaigns, ...inactive.campaigns];
    const responses = await mapLimit(campaigns, 4, async (campaign) => ({
      campaignId: campaign.id,
      stats: await lgmRequest<StatsResponse>(client.apiKey, `/campaigns/${encodeURIComponent(campaign.id)}/stats`),
    }));

    const metrics = emptyMetrics();
    const campaignMetrics: Record<string, AnalyticsMetrics> = {};
    for (const { campaignId, stats } of responses) {
      const campaignValue = emptyMetrics();
      const engagement = record(stats.engagementStats);
      const replies = record(engagement.replies);
      const relations = record(engagement.relations);
      const channel = record(engagement.channel);
      const linkedin = record(channel.linkedin);
      const linkedinRequest = record(linkedin.contactRequest);
      const linkedinMessage = record(linkedin.message);
      const email = record(channel.email);
      const status = record(engagement.status);
      const won = record(status.won);
      campaignValue.audience = count(engagement.audienceSize);
      campaignValue.connections = count(relations.newRelations, linkedinRequest.newRelations);
      campaignValue.linkedinReplies = count(replies.linkedinReplied, linkedinMessage.replied);
      campaignValue.emailReplies = count(replies.emailReplied, email.replied);
      campaignValue.conversions = count(won.converted, engagement.converted);
      campaignMetrics[campaignId] = campaignValue;
      metrics.audience += campaignValue.audience;
      metrics.connections += campaignValue.connections;
      metrics.linkedinReplies += campaignValue.linkedinReplies;
      metrics.emailReplies += campaignValue.emailReplies;
      metrics.conversions += campaignValue.conversions;
    }

    const sampledAt = Date.now();
    const snapshots = await saveAnalyticsSnapshot(clientId, { sampledAt, metrics, campaigns: campaignMetrics });
    const maxBoundaryAge = period === "week" ? 36 * 60 * 60 * 1000 : 4 * 24 * 60 * 60 * 1000;
    const previousBoundary = nearestAtOrBefore(snapshots, previousStart, maxBoundaryAge);
    const currentBoundary = nearestAtOrBefore(snapshots, currentStart, maxBoundaryAge);
    const elapsedInPeriod = Math.max(0, sampledAt - currentStart);
    const previousEnd = Math.min(currentStart, previousStart + elapsedInPeriod);
    const previousEndBoundary = nearestAtOrBefore(snapshots, previousEnd, maxBoundaryAge);
    const firstInPeriod = snapshots.find((item) => item.sampledAt >= currentStart && item.sampledAt < sampledAt) ?? null;
    const currentBaseline = currentBoundary ?? firstInPeriod;
    const previousPeriod = previousBoundary && previousEndBoundary
      ? intervalDifference(previousEndBoundary.campaigns ?? {}, previousBoundary, snapshots, previousEndBoundary.sampledAt)
      : null;
    const currentPeriod = currentBaseline
      ? intervalDifference(campaignMetrics, currentBaseline, snapshots, sampledAt)
      : null;
    const history = await getAnalyticsSnapshots(clientId);

    return NextResponse.json({
      metrics,
      currentPeriod,
      previousPeriod,
      currentBaselineAt: currentBaseline?.sampledAt ?? null,
      currentBaselineIsPartial: Boolean(currentBaseline && currentBaseline.sampledAt > currentStart),
      previousBaselineAt: previousBoundary?.sampledAt ?? null,
      historyStartedAt: history[0]?.sampledAt ?? sampledAt,
      sampledAt,
      campaignCount: campaigns.length,
      note: "Campaign totals can include the same lead in more than one campaign.",
    });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Client insights could not be loaded. Please try again." }, { status: 500 });
  }
}
