import { NextResponse } from "next/server";
import { getInvitationDetails, getSetupStatus } from "@/src/lib/auth-store";
import { currentUser, setupAvailability } from "@/src/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const inviteToken = new URL(request.url).searchParams.get("invite");
    const [setup, user, invitation] = await Promise.all([getSetupStatus(), currentUser(request), getInvitationDetails(inviteToken)]);
    return NextResponse.json({ ...setup, ...setupAvailability(), user, invitation }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Sign-in settings could not be loaded." }, { status: 500 });
  }
}
