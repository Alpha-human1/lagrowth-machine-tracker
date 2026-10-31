import { NextResponse } from "next/server";
import { getClientWithKey } from "@/src/lib/clients-store";
import { listCampaigns, LgmApiError } from "@/src/lib/lgm-api";
import { currentUser, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  const { clientId } = await context.params;
  try {
    const client = await getClientWithKey(clientId);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const scope = new URL(request.url).searchParams.get("scope") === "inactive" ? "inactive" : "active";
    const data = await listCampaigns(client.apiKey, scope);
    return NextResponse.json({ ...data, scope, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Campaigns could not be loaded. Check the encryption settings and try again." }, { status: 500 });
  }
}
