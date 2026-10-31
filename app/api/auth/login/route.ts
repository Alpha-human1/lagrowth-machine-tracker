import { NextResponse } from "next/server";
import { signIn } from "@/src/lib/auth-store";
import { isSameOrigin, setSessionCookie } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 8;
const failures = new Map<string, number[]>();

function attemptKeys(request: Request, email: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip")?.trim() || forwarded || "local";
  return [`address:${address}`, `email:${email}`];
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 254 || body.password.length > 128) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const keys = attemptKeys(request, email);
  const now = Date.now();
  for (const [key, attempts] of failures) {
    const recent = attempts.filter((time) => time > now - WINDOW_MS);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
  }
  if (failures.size > 5000) failures.clear();
  const activeAttempts = keys.map((key) => (failures.get(key) ?? []).filter((time) => time > now - WINDOW_MS));
  if (activeAttempts.some((items) => items.length >= LIMIT)) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  }

  try {
    const result = await signIn(email, body.password);
    if (!result) {
      keys.forEach((key, index) => failures.set(key, [...activeAttempts[index], now]));
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    keys.forEach((key) => failures.delete(key));
    const response = NextResponse.json({ user: result.user });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch {
    return NextResponse.json({ error: "Sign-in could not be completed. Try again." }, { status: 500 });
  }
}
