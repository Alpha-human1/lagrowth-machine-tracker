import { NextResponse } from "next/server";
import { getClientWithKey } from "@/src/lib/clients-store";
import { lgmRequest, LgmApiError } from "@/src/lib/lgm-api";
import { currentUser, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ clientId: string; campaignId: string }> }) {
  const user = await currentUser(_request);
  if (!user) return unauthorizedResponse();
  const { clientId, campaignId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(campaignId)) return NextResponse.json({ error: "Invalid campaign id." }, { status: 400 });
  try {
    const client = await getClientWithKey(clientId);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const [stats, steps] = await Promise.all([
      lgmRequest<Record<string, unknown>>(client.apiKey, `/campaigns/${encodeURIComponent(campaignId)}/stats`),
      lgmRequest<{ data?: unknown[] }>(client.apiKey, `/campaigns/${encodeURIComponent(campaignId)}/steps`).catch(() => ({ data: [] })),
    ]);
    return NextResponse.json({ ...stats, steps: Array.isArray(steps.data) ? steps.data : [] });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Campaign statistics could not be loaded." }, { status: 500 });
  }
}
