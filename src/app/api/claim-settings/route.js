import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMemberStatus } from "@/lib/telegram";
import { claimGate, claimRulesConflict, claimSettingsOf, normalizeClaimSettings } from "@/lib/claim-rules";
import { pendingFilter, serializeClaimWindows, upcomingPointPrice } from "@/lib/point-price";
import { loadPlatformDefault } from "@/lib/platform-price";
import { queryInt } from "@/lib/query";

export const dynamic = "force-dynamic";

async function creatorChat(request, chatId) {
  const auth = authenticate(request);
  if (!Number.isSafeInteger(chatId)) return { error: Response.json({ error: "chatId is required" }, { status: 400 }) };
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return { error: Response.json({ error: "chat not found" }, { status: 404 }) };
  // the platform default its price builds on (lib/platform-price.js)
  await loadPlatformDefault();
  if (chat.creator !== auth.user.id) {
    return { error: Response.json({ error: "only the chat creator can change claim rules" }, { status: 403 }) };
  }
  return { auth, chat };
}

// The price decrease members are waiting to claim before, if any: while it is
// pending the card cannot pause claims or close the last claim window
// (claimRulesConflict), and says why.
function pendingDecrease(chat, settings, now) {
  let pending = null;
  try {
    pending = upcomingPointPrice(chat, now);
  } catch {
    pending = null;
  }
  if (!pending) return null;
  return {
    effective_at: Math.floor(pending.effective_at.getTime() / 1000),
    ...serializeClaimWindows(settings, now, pending.effective_at),
  };
}

function view(settings, chat) {
  const now = new Date();
  return { ok: true, settings, gate: claimGate(settings), pending_decrease: pendingDecrease(chat, settings, now) };
}

export async function GET(request) {
  try {
    const chatId = queryInt(new URL(request.url).searchParams, "chatId");
    const { chat, error } = await creatorChat(request, chatId);
    if (error) return error;
    return Response.json(view(claimSettingsOf(chat), chat));
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
    const conflict = claimRulesConflict(claimSettingsOf(chat), settings, chat, now);
    if (conflict) {
      return Response.json(
        { error: conflict.error, code: conflict.code, effective_at: Math.floor(conflict.effective_at.getTime() / 1000) },
        { status: 409 },
      );
    }
    // Conditional on the pending decrease checked above: one scheduled (or
    // replaced) meanwhile was planned against the rules being replaced.
    const res = await chats.updateOne(
      { id: chat.id, ...pendingFilter(chat) },
      { $set: { claim_settings: settings, claim_settings_updated_by: auth.user.id, claim_settings_updated_at: now } },
    );
    if (res.matchedCount === 0) {
      return Response.json({ error: "the claim rules or the price were changed meanwhile; reload and try again" }, { status: 409 });
    }
    // A scheduled decrease protects the points still maturing when it takes
    // effect (lib/point-price.js). Until it is due, a longer maturation widens
    // that protection; a shorter one doesn't narrow what members were already
    // told when it was announced. Once due, its snapshot is frozen.
    await chats.updateOne(
      { id: chat.id, "point_price_pending.effective_at": { $gt: now } },
      { $max: { "point_price_pending.maturation_days": settings.maturation_days } },
    );
    return Response.json(view(settings, chat));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
