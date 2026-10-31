import { NextResponse } from "next/server";
import { createInvitation, listTeam } from "@/src/lib/auth-store";
import { currentUser, isSameOrigin } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only an administrator can manage access." }, { status: 403 });
  return NextResponse.json(await listTeam(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only an administrator can manage access." }, { status: 403 });

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  }
  if (typeof body.email !== "string") return NextResponse.json({ error: "Enter an email address." }, { status: 400 });

  try {
    const configuredBaseUrl = process.env.APP_BASE_URL;
    if (process.env.NODE_ENV === "production" && !configuredBaseUrl) {
      return NextResponse.json({ error: "Invitation links are not available right now." }, { status: 503 });
    }
    const inviteUrl = new URL("/", configuredBaseUrl || request.url);
    if (process.env.NODE_ENV === "production" && inviteUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Invitation links are not available right now." }, { status: 503 });
    }
    const result = await createInvitation(body.email, user.id);
    inviteUrl.searchParams.set("invite", result.token);
    return NextResponse.json({ invitation: result.invitation, inviteUrl: inviteUrl.toString() }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The invitation could not be created.";
    return NextResponse.json({ error: message }, { status: message.includes("already") ? 409 : 400 });
  }
}
