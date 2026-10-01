import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { botApi, getChatMemberStatus } from "@/lib/telegram";
import { resolveEconomyChatId, telegramChatId } from "@/lib/chat-ids";
import {
  ACTIVE_WINDOW_DAYS,
  SUBSCRIPTION_PERIOD_SECONDS,
  serviceState,
  subscriptionConfig,
  subscriptionPayload,
  tierFor,
} from "@/lib/subscription";
import { queryInt } from "@/lib/query";

export const dynamic = "force-dynamic";

async function creatorChat(request, chatId) {
  const auth = authenticate(request);
  if (!Number.isSafeInteger(chatId)) return { error: Response.json({ error: "chatId is required" }, { status: 400 }) };
  // a supergroup's own id stands for its economy (lib/chat-ids.js)
  const chats = await getCollection("chats");
  const chat = await chats.findOne({ id: await resolveEconomyChatId(chatId, chats) });
  if (!chat) return { error: Response.json({ error: "chat not found" }, { status: 404 }) };
  if (chat.creator !== auth.user.id) {
    return { error: Response.json({ error: "only the chat creator can manage the subscription" }, { status: 403 }) };
  }
  return { auth, chat };
}

// Members who wrote at least one message in the window (messages.date is the
// Telegram epoch in seconds). The bot indexes {chat_id, date}.
async function activeMembers(chatId, now) {
  const since = Math.floor(now.getTime() / 1000) - ACTIVE_WINDOW_DAYS * 86400;
  const ids = await (await getCollection("messages")).distinct("user_id", { chat_id: chatId, date: { $gte: since } });
  return ids.length;
}

// A chat with a reward jetton and no trial yet starts it now, exactly as the
// bot would on its next reaction; the trial never restarts.
async function withTrial(chat, now) {
  if (!chat.jetton_master || chat.trial_started_at || chat.paid_until) return chat;
  const chats = await getCollection("chats");
  await chats.updateOne({ id: chat.id, trial_started_at: null }, { $set: { trial_started_at: now } });
  return chats.findOne({ id: chat.id });
}

const sec = (date) => (date ? Math.floor(new Date(date).getTime() / 1000) : null);

async function view(chat, userId, now) {
  const config = subscriptionConfig();
  if (!config.enabled) return { ok: true, enabled: false };
  const service = serviceState(chat, now, config);
  const active = await activeMembers(chat.id, now);
  const sub = chat.subscription || null;
  return {
    ok: true,
    enabled: true,
    state: service.state,
    accrues: service.accrues,
    has_jetton: Boolean(chat.jetton_master),
    trial_days: config.trialDays,
    grace_days: config.graceDays,
    trial_started_at: sec(chat.trial_started_at),
    paid_until: sec(chat.paid_until),
    ends_at: sec(service.ends_at),
    grace_until: sec(service.grace_until),
    active_members: active,
    active_window_days: ACTIVE_WINDOW_DAYS,
    price_stars: tierFor(active, config.tiers).stars,
    subscription: sub
      ? { recurring: Boolean(sub.recurring), payer_is_you: sub.payer_id === userId, stars: sub.stars ?? null }
      : null,
  };
}

export async function GET(request) {
  try {
    const chatId = queryInt(new URL(request.url).searchParams, "chatId");
    const { auth, chat, error } = await creatorChat(request, chatId);
    if (error) return error;
    const now = new Date();
    const current = subscriptionConfig().enabled ? await withTrial(chat, now) : chat;
    return Response.json(await view(current, auth.user.id, now));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}

// Creates the invoice link for a monthly Stars subscription at the chat's
// current price. The bot confirms the payer is still the creator before
// Telegram charges (pre_checkout_query) and records the payment.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const { auth, chat, error } = await creatorChat(request, Number(body?.chatId));
    if (error) return error;
    const config = subscriptionConfig();
    if (!config.enabled) return Response.json({ error: "subscriptions are not enabled" }, { status: 409 });
    if (!chat.jetton_master) {
      return Response.json({ error: "set the reward jetton first (/jetton in the chat)" }, { status: 409 });
    }
    if ((await getChatMemberStatus(telegramChatId(chat), auth.user.id)) !== "creator") {
      return Response.json({ error: "Telegram does not confirm you as the chat creator" }, { status: 403 });
    }
    const now = new Date();
    const sub = chat.subscription;
    if (sub?.recurring && sub.payer_id === auth.user.id && new Date(chat.paid_until) > now) {
      return Response.json({ error: "you already have a subscription for this chat" }, { status: 409 });
    }

    const stars = tierFor(await activeMembers(chat.id, now), config.tiers).stars;
    const title = (chat.title || "").slice(0, 60);
    const link = await botApi("createInvoiceLink", {
      title: "Achivator",
      description: title ? `Points for reactions in «${title}», 30 days` : "Points for reactions in your chat, 30 days",
      payload: subscriptionPayload(chat.id),
      currency: "XTR",
      prices: [{ label: "30 days", amount: stars }],
      subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
    });
    return Response.json({ ok: true, link, stars });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
