import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMemberStatus } from "@/lib/telegram";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import {
  FALLBACK_DECIMALS,
  HISTORY_LIMIT,
  MAX_POINT_PRICE,
  hasCustomPointPrice,
  normalizePointPrice,
  platformPointPrice,
  pointPriceFor,
  serializePriceHistory,
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

function view(chat, jetton) {
  let price = null;
  try {
    price = pointPriceFor(chat);
  } catch {
    // a corrupted stored price: show none, the creator can save a new one
  }
  return {
    ok: true,
    price,
    custom: hasCustomPointPrice(chat),
    platform_price: platformPointPrice(),
    max_price: MAX_POINT_PRICE,
    jetton,
    // what the price is validated against
    decimals: jetton?.decimals ?? FALLBACK_DECIMALS,
    decimals_known: Number.isInteger(jetton?.decimals),
    history: serializePriceHistory(chat),
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
// point, or null to go back to the platform default. Off-chain and free, like
// the claim rules; the next claim voucher is sized with the new price.
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
    const platform = platformPointPrice();
    let next;
    try {
      next = body?.price === null ? null : normalizePointPrice(body?.price, jetton?.decimals ?? null);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    let before;
    try {
      before = pointPriceFor(chat);
    } catch {
      before = String(chat.point_price); // replacing a corrupted value
    }
    const after = next ?? platform;
    const stored = hasCustomPointPrice(chat) ? chat.point_price : null;
    if (next === stored) return Response.json(view(chat, jetton));

    // Conditional on the value we read, so two concurrent saves cannot both
    // log a change from the same "old" price (the history must chain).
    const chatsCol = await getCollection("chats");
    const entry = { old: before, new: after, at: new Date(), by: auth.user.id };
    const res = await chatsCol.findOneAndUpdate(
      { id: chat.id, point_price: stored },
      {
        ...(next === null ? { $unset: { point_price: "" } } : { $set: { point_price: next } }),
        // the effective price did not move (e.g. custom = platform default):
        // nothing for members to be warned about
        ...(before !== after ? { $push: { point_price_history: { $each: [entry], $slice: -HISTORY_LIMIT } } } : {}),
      },
      { returnDocument: "after" },
    );
    if (!res) {
      return Response.json({ error: "the price was changed meanwhile; reload and try again" }, { status: 409 });
    }
    return Response.json(view(res, jetton));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
