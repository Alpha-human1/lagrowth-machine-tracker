import { NextResponse } from "next/server";
import { createFirstAdmin } from "@/src/lib/auth-store";
import { isSameOrigin, setSessionCookie, validInitialAdminSecret } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });

  let body: { email?: unknown; password?: unknown; setupSecret?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  if (!validInitialAdminSecret(request, body.setupSecret)) {
    const production = process.env.NODE_ENV === "production";
    return NextResponse.json({
      error: production
        ? process.env.INITIAL_ADMIN_SETUP_SECRET ? "The administrator setup code is incorrect." : "Administrator setup is not configured on this server yet."
        : "Administrator setup could not be verified.",
    }, { status: production && !process.env.INITIAL_ADMIN_SETUP_SECRET ? 503 : 403 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  try {
    const result = await createFirstAdmin(body.email, body.password);
    const response = NextResponse.json({ user: result.user }, { status: 201 });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Administrator setup could not be completed.";
    return NextResponse.json({ error: message }, { status: message.includes("already") ? 409 : 400 });
  }
}
