import { NextResponse } from "next/server";
import { revokeInvitation } from "@/src/lib/auth-store";
import { currentUser, isSameOrigin } from "@/src/lib/auth-session";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ invitationId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only an administrator can manage access." }, { status: 403 });
  const { invitationId } = await context.params;
  const revoked = await revokeInvitation(invitationId);
  return revoked ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Invitation not found." }, { status: 404 });
}
