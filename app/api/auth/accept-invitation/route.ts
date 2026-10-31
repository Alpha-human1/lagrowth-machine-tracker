import { NextResponse } from "next/server";
import { acceptInvitation } from "@/src/lib/auth-store";
import { isSameOrigin, setSessionCookie } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });

  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 400 });
  }
  if (typeof body.token !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 400 });
  }

  try {
    const result = await acceptInvitation(body.token, body.password);
    const response = NextResponse.json({ user: result.user }, { status: 201 });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The invitation could not be accepted.";
    return NextResponse.json({ error: message }, { status: message.includes("12 and 128") ? 400 : 410 });
  }
}
