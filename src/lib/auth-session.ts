import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getUserForSession, type PublicUser } from "@/src/lib/auth-store";

export const SESSION_COOKIE = "lagrowth_session";
const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export function readSessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return item?.slice(SESSION_COOKIE.length + 1) || null;
}

export async function currentUser(request: Request): Promise<PublicUser | null> {
  return getUserForSession(readSessionToken(request));
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function isSameOrigin(request: Request) {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return request.headers.get("sec-fetch-site") === "same-origin";

  try {
    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host")?.trim() || requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "");
    const protocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
    const requestOrigin = new URL(`${protocol}//${host}`);
    return origin.origin === requestOrigin.origin;
  } catch {
    return false;
  }
}

export function isLoopbackRequest(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host")?.trim() || requestUrl.host;
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function setupAvailability() {
  const production = process.env.NODE_ENV === "production";
  const setupSecretRequired = production;
  const setupAvailable = !production || Boolean(process.env.INITIAL_ADMIN_SETUP_SECRET);
  return { setupAvailable, setupSecretRequired };
}

export function validInitialAdminSecret(request: Request, candidate: unknown) {
  if (process.env.NODE_ENV !== "production") return isLoopbackRequest(request);
  const configured = process.env.INITIAL_ADMIN_SETUP_SECRET;
  if (!configured || typeof candidate !== "string" || candidate.length > 512) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
}

export function adminRequiredResponse() {
  return NextResponse.json({ error: "Only an administrator can manage this." }, { status: 403 });
}
