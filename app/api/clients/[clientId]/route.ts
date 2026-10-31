import { NextResponse } from "next/server";
import { getClientWithKey, updateClient } from "@/src/lib/clients-store";
import { LgmApiError, lgmRequest, type CampaignListResponse } from "@/src/lib/lgm-api";
import { adminRequiredResponse, currentUser, isSameOrigin, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ clientId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  if (user.role !== "admin") return adminRequiredResponse();
  const { clientId } = await context.params;
  let body: { name?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a client name." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Client name must be between 1 and 80 characters." }, { status: 400 });

  try {
    if (apiKey) await lgmRequest<CampaignListResponse>(apiKey, "/campaigns?skip=0&limit=1");
    const client = await updateClient(clientId, { name, ...(apiKey ? { apiKey } : {}) });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json({ client });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The client could not be updated." }, { status: 500 });
  }
}
