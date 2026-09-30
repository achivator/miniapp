import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMemberStatus } from "@/lib/telegram";
import { getTonConfig } from "@/lib/ton/config";
import {
  fetchJettonMetadata,
  fetchPoolClaimControls,
  fetchPoolLedgerBalance,
  getPoolStatus,
  runGetMethod,
  stackItemToAddress,
} from "@/lib/ton/rpc";
import { chatDebt } from "@/lib/lots";
import { budgetDays, payoutCoverage, serializeCoverage } from "@/lib/payout-coverage";
import { sameAddress } from "@/lib/pool-members";
import { claimGate, claimSettingsOf } from "@/lib/claim-rules";
import {
  FALLBACK_DECIMALS,
  MAX_POINT_PRICE,
  announcementDoc,
  decreaseEffectiveAt,
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

// Whether members can claim what they hold before a decrease applies: the
// chat's debt (every member's unclaimed points, valued as claims value them -
// maturing points included, since they will be claimed later at the price the
// valuation gives them - plus vouchers issued and not yet used) against the
// pool's balance and daily payout limit over the notice period. For the
// pending decrease if there is one, else for a decrease requested now.
// { coverage, coverage_error }: never throws, the card works without it.
// It costs several chain reads and a pass over every member's points, so it
// is computed only when asked (`force`: GET ?coverage=1, the card asks once a
// decrease is being typed) or while a decrease is pending.
async function coverageOf(chat, jetton, now, force = false) {
  const none = (why) => ({ coverage: null, coverage_error: why });
  let scheduled = false;
  try {
    scheduled = upcomingPointPrice(chat, now) !== null;
  } catch {
    scheduled = false;
  }
  if (!force && !scheduled) return none(null);
  if (!chat.jetton_master) return none("this chat has no jetton");
  const decimals = jetton?.decimals;
  if (!Number.isInteger(decimals)) return none("cannot read the jetton's decimals right now");
  const cfg = getTonConfig();
  if (!cfg.masterAddress) return none("MASTER_ADDRESS is not configured");
  try {
    const pool = await getPoolStatus(cfg.masterAddress, chat.id);
    if (!pool.poolAddress || !pool.active) return none("the pool is not activated yet");
    const nowSec = Math.floor(now.getTime() / 1000);
    const [ledger, controls, adminStack, debt, vouchers] = await Promise.all([
      fetchPoolLedgerBalance(pool.poolAddress, chat.jetton_master),
      fetchPoolClaimControls(pool.poolAddress, chat.jetton_master),
      runGetMethod(pool.poolAddress, "poolAdmin", []).catch(() => null),
      chatDebt(chat, decimals, now),
      (await getCollection("claims"))
        .find(
          { chat_id: chat.id, status: "issued", expiry: { $gt: nowSec } },
          { projection: { amount: 1, jetton_master: 1 } },
        )
        .toArray(),
    ]);
    // Vouchers in hand draw on the same balance and budget. One already used
    // but not reconciled yet is counted twice (its payout already left the
    // balance): an overestimate, the safe side.
    const issued = vouchers
      .filter((c) => sameAddress(c.jetton_master, chat.jetton_master))
      .reduce((sum, c) => sum + BigInt(c.amount || 0), 0n);
    let pending = null;
    try {
      pending = upcomingPointPrice(chat, now);
    } catch {
      pending = null;
    }
    const effectiveAt = pending ? pending.effective_at : decreaseEffectiveAt(now);
    const coverage = payoutCoverage({
      debt: debt.units + issued,
      poolBalance: ledger,
      limit: controls.limit,
      days: budgetDays(now.getTime(), effectiveAt.getTime()),
    });
    let admin = null;
    try {
      admin = adminStack ? stackItemToAddress(adminStack[0]) : null;
    } catch {
      admin = null;
    }
    return {
      coverage: serializeCoverage(coverage, {
        decimals,
        debt_points: debt.points,
        members_owed: debt.members,
        issued_vouchers: issued.toString(),
        // left of today's budget (not counted in capacity: may be spent)
        claimable_today: controls.claimableToday.toString(),
        claims_paused: controls.paused,
        // the decrease this is for: the pending one, or one requested now
        for_pending: pending !== null,
        effective_at: Math.floor(effectiveAt.getTime() / 1000),
        // only this wallet can change the limit (pool-admin-tx "limit")
        pool_admin: admin ? admin.toString() : null,
        network: cfg.network,
      }),
      coverage_error: null,
    };
  } catch (e) {
    return none(`cannot check the pool right now: ${e.message}`);
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
    const { searchParams } = new URL(request.url);
    const chatId = Number(searchParams.get("chatId"));
    const { chat, error } = await creatorChat(request, chatId);
    if (error) return error;
    const jetton = await jettonOf(chat);
    const force = searchParams.get("coverage") === "1";
    return Response.json(view(chat, jetton, await coverageOf(chat, jetton, new Date(), force)));
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
      plan = planPointPriceChange(chat, next, {
        now,
        by: auth.user.id,
        symbol,
        // snapshotted with the change: lots are valued by the maturation in
        // force when a decrease took effect (lib/lot-pricing.js)
        maturationDays: claimSettingsOf(chat).maturation_days,
      });
    }
    if (!plan) return Response.json(view(chat, jetton, await coverageOf(chat, jetton, new Date(), body?.coverage === true)));

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
    if (plan.announcements.length > 0) {
      try {
        // ordered: a written-out due decrease is announced before what the
        // creator just did
        await (await getCollection("announcements")).insertMany(
          plan.announcements.map((a) => announcementDoc(chat.id, a, now)),
          { ordered: true },
        );
        announced = true;
      } catch (e) {
        console.error("point-price: announcement insert failed", chat.id, e);
        announced = false;
      }
    }
    return Response.json(
      view(res, jetton, { announced, ...(await coverageOf(res, jetton, new Date(), body?.coverage === true)) }),
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
