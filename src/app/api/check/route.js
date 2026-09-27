import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { user, dev } = authenticate(request);
    return Response.json({ success: true, user: { id: user.id, username: user.username || null }, dev });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }
}
