import { NextResponse } from "next/server";
import { endSession } from "@/src/lib/auth-store";
import { clearSessionCookie, isSameOrigin, readSessionToken } from "@/src/lib/auth-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
  try {
    await endSession(readSessionToken(request));
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Sign-out could not be completed." }, { status: 500 });
  }
}
