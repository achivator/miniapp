import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMemberStatus } from "@/lib/telegram";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import { claimGate, claimSettingsOf } from "@/lib/claim-rules";
import {
  FALLBACK_DECIMALS,
  MAX_POINT_PRICE,
  announcementDoc,
  hasCustomPointPrice,
  normalizePointPrice,
  planPointPriceCancel,
  planPointPriceChange,
  platformPointPrice,
  pointPriceFor,
  pointPriceNoticeDays,
  serializePendingPrice,
  serializePriceHistory,
  upcomingPointPrice,
} from "@/lib/point-price";

export const dynamic = "force-dynamic";

// Same gate as the claim rules: the stored creator flag to read, plus a live
// Telegram check before any change.
async function creatorChat(request, chatId) {
  const auth = authenticate(request);
  if (!Number.isSafeInteger(chatId)) return { error: Response.json({ error: "chatId is required" }, { status: 400 }) };
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return { error: Response.json({ error: "chat not found" }, { status: 404 }) };
  if (chat.creator !== auth.user.id) {
    return { error: Response.json({ error: "only the chat creator can change the point price" }, { status: 403 }) };
  }
  return { auth, chat };
}

// Decimals of the chat's jetton, or null when there is none or it cannot be
// read right now (the price is then validated against 9 and re-checked when
// a claim is signed).
async function jettonOf(chat) {
  if (!chat.jetton_master) return null;
  try {
    const metadata = await fetchJettonMetadata(chat.jetton_master);
    return { master: chat.jetton_master, symbol: metadata.symbol, decimals: metadata.decimals };
  } catch {
    return { master: chat.jetton_master, symbol: null, decimals: null };
  }
}

function view(chat, jetton, extra = {}) {
  const now = new Date();
  let price = null;
  try {
    price = pointPriceFor(chat, now);
  } catch {
    // a corrupted stored price: show none, the creator can save a new one
  }
  let pending = null;
  try {
    pending = serializePendingPrice(upcomingPointPrice(chat, now));
  } catch {
    // a malformed pending: the price above is null too, saving clears it
  }
  return {
    ok: true,
    price,
    custom: hasCustomPointPrice(chat, now),
    platform_price: platformPointPrice(),
    max_price: MAX_POINT_PRICE,
    // a decrease waiting for its notice period, or null
    pending,
    // how long a decrease requested now would wait
    notice_days: pointPriceNoticeDays(),
    // members cannot claim at the old price while claims are paused, which
    // defeats the notice: the card warns the creator
    claim_gate: claimGate(claimSettingsOf(chat)),
    jetton,
    // what the price is validated against
    decimals: jetton?.decimals ?? FALLBACK_DECIMALS,
    decimals_known: Number.isInteger(jetton?.decimals),
    history: serializePriceHistory(chat, 10, now),
    ...extra,
  };
}

export async function GET(request) {
  try {
    const chatId = Number(new URL(request.url).searchParams.get("chatId"));
    const { chat, error } = await creatorChat(request, chatId);
    if (error) return error;
    return Response.json(view(chat, await jettonOf(chat)));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}

// Body: { chatId, price } where price is a decimal string of jettons per
// point, or null to go back to the platform default; or { chatId,
// cancelPending: true } to cancel a scheduled decrease. Off-chain and free,
// like the claim rules. A higher (or equal) price applies to the next claim;
// a lower one waits the notice period (see planPointPriceChange) and the bot
// announces it in the chat.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const { auth, chat, error } = await creatorChat(request, Number(body?.chatId));
    if (error) return error;
    // A stale creator flag must not keep control of a chat's payouts.
    if ((await getChatMemberStatus(chat.id, auth.user.id)) !== "creator") {
      return Response.json({ error: "Telegram does not confirm you as the chat creator" }, { status: 403 });
    }

    const jetton = await jettonOf(chat);
    const now = new Date();
    const symbol = jetton?.symbol ?? null;
    let plan;
    if (body?.cancelPending === true) {
      // 409 when there is nothing to cancel or it already took effect
      plan = planPointPriceCancel(chat, { now, symbol });
    } else {
      let next;
      try {
        next = body?.price === null ? null : normalizePointPrice(body?.price, jetton?.decimals ?? null);
      } catch (e) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      plan = planPointPriceChange(chat, next, { now, by: auth.user.id, symbol });
    }
    if (!plan) return Response.json(view(chat, jetton));

    // Conditional on the price and the pending decrease we read, so two
    // concurrent saves cannot both log a change from the same "old" price
    // (the history must chain), and a save cannot race the bot applying a
    // due decrease.
    const res = await (await getCollection("chats")).findOneAndUpdate(plan.filter, plan.update, {
      returnDocument: "after",
    });
    if (!res) {
      return Response.json({ error: "the price was changed meanwhile; reload and try again" }, { status: 409 });
    }

    // Only after the chat write succeeded, so the bot never announces a
    // change that did not happen. Without a replica set there is no
    // transaction to share: if this insert fails the change stands and the
    // creator is told the chat was not notified.
    let announced = null;
    if (plan.announcement) {
      try {
        await (await getCollection("announcements")).insertOne(announcementDoc(chat.id, plan.announcement, now));
        announced = true;
      } catch (e) {
        console.error("point-price: announcement insert failed", chat.id, e);
        announced = false;
      }
    }
    return Response.json(view(res, jetton, { announced }));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
