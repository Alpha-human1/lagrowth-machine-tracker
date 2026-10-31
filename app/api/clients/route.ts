import { NextResponse } from "next/server";
import { createClient, listClients } from "@/src/lib/clients-store";
import { LgmApiError, lgmRequest, type CampaignListResponse } from "@/src/lib/lgm-api";
import { adminRequiredResponse, currentUser, isSameOrigin, unauthorizedResponse } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  try {
    return NextResponse.json({ clients: await listClients() });
  } catch {
    return NextResponse.json({ error: "Saved clients could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
  const user = await currentUser(request);
  if (!user) return unauthorizedResponse();
  if (user.role !== "admin") return adminRequiredResponse();
  let body: { name?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a client name and API key." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Client name must be between 1 and 80 characters." }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "Enter the API key for this client." }, { status: 400 });

  try {
    await lgmRequest<CampaignListResponse>(apiKey, "/campaigns?skip=0&limit=1");
    const client = await createClient(name, apiKey);
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    if (error instanceof LgmApiError) return NextResponse.json({ error: error.message }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The client could not be saved." }, { status: 500 });
  }
}
