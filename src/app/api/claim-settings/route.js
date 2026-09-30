import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMemberStatus } from "@/lib/telegram";
import { claimGate, claimSettingsOf, normalizeClaimSettings } from "@/lib/claim-rules";

export const dynamic = "force-dynamic";

async function creatorChat(request, chatId) {
  const auth = authenticate(request);
  if (!Number.isSafeInteger(chatId)) return { error: Response.json({ error: "chatId is required" }, { status: 400 }) };
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return { error: Response.json({ error: "chat not found" }, { status: 404 }) };
  if (chat.creator !== auth.user.id) {
    return { error: Response.json({ error: "only the chat creator can change claim rules" }, { status: 403 }) };
  }
  return { auth, chat };
}

function view(settings) {
  return { ok: true, settings, gate: claimGate(settings) };
}

export async function GET(request) {
  try {
    const chatId = Number(new URL(request.url).searchParams.get("chatId"));
    const { chat, error } = await creatorChat(request, chatId);
    if (error) return error;
    return Response.json(view(claimSettingsOf(chat)));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}

// Claim rules are off-chain: saving them costs nothing and needs no wallet.
// The backend enforces them when it signs claim vouchers.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const { auth, chat, error } = await creatorChat(request, Number(body?.chatId));
    if (error) return error;
    // A stale creator flag must not keep control of a chat's payouts.
    if ((await getChatMemberStatus(chat.id, auth.user.id)) !== "creator") {
      return Response.json({ error: "Telegram does not confirm you as the chat creator" }, { status: 403 });
    }

    let settings;
    try {
      settings = normalizeClaimSettings({ ...claimSettingsOf(chat), ...(body?.settings || {}) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    const chats = await getCollection("chats");
    const now = new Date();
    await chats.updateOne(
      { id: chat.id },
      { $set: { claim_settings: settings, claim_settings_updated_by: auth.user.id, claim_settings_updated_at: now } },
    );
    // A scheduled decrease protects the points still maturing when it takes
    // effect, by the maturation in force then (lib/point-price.js): until it
    // is due, that is this setting. Once due, its snapshot is frozen.
    await chats.updateOne(
      { id: chat.id, "point_price_pending.effective_at": { $gt: now } },
      { $set: { "point_price_pending.maturation_days": settings.maturation_days } },
    );
    return Response.json(view(settings));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
