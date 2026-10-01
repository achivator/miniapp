import { Address } from "@ton/core";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchJettonMetadata, fetchPoolClaimControls, getPoolStatus } from "@/lib/ton/rpc";
import { claimSettingsOf } from "@/lib/claim-rules";
import { limitRaiseRecord } from "@/lib/payout-coverage";
import { decreaseEffectiveAt, noticeEffectiveAt, upcomingPointPrice } from "@/lib/point-price";
import {
  buildSetClaimLimitBody,
  buildSetClaimsPausedBody,
  buildWithdrawRemainderBody,
} from "@/lib/ton/vouchers";
import { parseUnits } from "@/lib/ton/amounts";
import { GAS } from "@/lib/ton/constants";

export const dynamic = "force-dynamic";

// Builds the pool admin's own transactions: withdraw, pause/resume claims,
// daily claim limit. Nothing is signed here - the pool only obeys its admin
// wallet - this keeps the message layouts in one place (lib/ton/vouchers.js).

// The decrease a limit raised from the price card is for: the pending one,
// else one requested now (the card offers the raise before it is scheduled).
function noticeDecreaseAt(chat, now) {
  try {
    const pending = upcomingPointPrice(chat, now);
    if (pending) return pending.effective_at;
  } catch {
    // malformed pending: as if none
  }
  const noticeEnds = decreaseEffectiveAt(now);
  return noticeEffectiveAt(claimSettingsOf(chat), now, noticeEnds) ?? noticeEnds;
}

// A limit raised so members can claim before a price decrease ({ purpose:
// "price_notice" }) is recorded with the limit it replaces, so the pool page
// can remind the admin to set it back afterwards (lib/payout-coverage.js
// limitRaiseRecord). Recorded on request: whether the wallet sends it is not
// known here, and a raise that never lands is dropped after the decrease.
async function recordNoticeRaise(chat, pool, target, userId) {
  let controls;
  try {
    controls = await fetchPoolClaimControls(pool.poolAddress, chat.jetton_master);
  } catch (e) {
    const error = new Error(`TON RPC failed: ${e.message}`);
    error.status = 502;
    throw error;
  }
  const now = new Date();
  const record = limitRaiseRecord(chat.claim_limit_raise ?? null, {
    jettonMaster: chat.jetton_master,
    currentLimit: controls.limit,
    target,
    effectiveAt: noticeDecreaseAt(chat, now),
    now,
    by: userId,
  });
  if (record) await (await getCollection("chats")).updateOne({ id: chat.id }, { $set: { claim_limit_raise: record } });
}
export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const chatId = Number(body?.chatId);
  const action = String(body?.action || "");
  if (!Number.isSafeInteger(chatId) || !["withdraw", "pause", "resume", "limit"].includes(action)) {
    return Response.json({ error: "chatId and a valid action are required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (chat.creator !== auth.user.id) {
    return Response.json({ error: "only the chat creator can manage the pool" }, { status: 403 });
  }

  let pool;
  try {
    pool = await getPoolStatus(cfg.masterAddress, chatId);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!pool.active) return Response.json({ error: "pool is not activated yet" }, { status: 409 });

  const tx = (payload, amount = GAS.adminControlTon) =>
    Response.json({ ok: true, to: pool.poolAddress.toString(), amount, payload_b64: payload.toBoc().toString("base64") });

  if (action === "pause" || action === "resume") return tx(buildSetClaimsPausedBody(action === "pause"));

  // withdraw / limit need the jetton and its decimals
  if (!chat.jetton_master) return Response.json({ error: "this chat has no jetton" }, { status: 400 });
  let metadata;
  try {
    metadata = await fetchJettonMetadata(chat.jetton_master);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (metadata.decimals === null) {
    return Response.json({ error: "cannot read this jetton's decimals right now, try again later" }, { status: 502 });
  }
  let amount;
  try {
    amount = parseUnits(String(body?.amount ?? ""), metadata.decimals);
  } catch {
    return Response.json({ error: `invalid amount: ${body?.amount}` }, { status: 400 });
  }

  if (action === "limit") {
    if (body?.purpose === "price_notice") {
      try {
        await recordNoticeRaise(chat, pool, amount, auth.user.id);
      } catch (e) {
        // no tx without the reminder to set it back
        return Response.json({ error: e.message }, { status: e.status || 500 });
      }
    }
    // 0 restores the default budget (10% of the balance per day)
    return tx(buildSetClaimLimitBody({ jettonMaster: chat.jetton_master, dailyLimit: amount }));
  }

  if (amount <= 0n) return Response.json({ error: "amount must be positive" }, { status: 400 });
  let to;
  try {
    to = Address.parse(String(body?.to || ""));
  } catch {
    return Response.json({ error: "a valid destination wallet is required" }, { status: 400 });
  }
  return tx(buildWithdrawRemainderBody({ jettonMaster: chat.jetton_master, amount, to }), GAS.withdrawTon);
}
