import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { Address } from "@ton/core";
import { fetchJettonMetadata, fetchPoolClaimControls, fetchPoolLedgerBalance, getPoolStatus } from "@/lib/ton/rpc";
import { buildClaimVoucherCell, buildClaimBody, signVoucher, defaultExpiry } from "@/lib/ton/vouchers";
import { formatUnits } from "@/lib/ton/amounts";
import { priceFitsDecimals } from "@/lib/point-price";
import { serializeBreakdown } from "@/lib/lot-pricing";
import { chatLots } from "@/lib/lots";
import { GAS, VOUCHER_TAG } from "@/lib/ton/constants";
import { reconcileExpiredClaims, claimPoints, nowSeconds } from "@/lib/rewards";
import { claimGate, claimSettingsOf, claimablePoints } from "@/lib/claim-rules";
import { loadPlatformDefault } from "@/lib/platform-price";
import { resolveEconomyChatId } from "@/lib/chat-ids";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }
  // the platform default every price here builds on (lib/platform-price.js)
  try {
    await loadPlatformDefault();
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }

  const body = await request.json().catch(() => null);
  const requestedChatId = Number(body?.chatId);
  const wallet = body?.wallet;
  if (!Number.isSafeInteger(requestedChatId) || !wallet) {
    return Response.json({ error: "chatId and wallet are required" }, { status: 400 });
  }
  let recipient;
  try {
    recipient = Address.parse(wallet);
  } catch {
    return Response.json({ error: "invalid wallet address" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress) {
    return Response.json({ error: "MASTER_ADDRESS is not configured" }, { status: 500 });
  }
  if (!process.env.BACKEND_SECRET) {
    return Response.json({ error: "BACKEND_SECRET is not configured" }, { status: 500 });
  }

  const userId = auth.user.id;
  const chatsCol = await getCollection("chats");
  const rewardsCol = await getCollection("rewards");
  const claimsCol = await getCollection("claims");
  const countersCol = await getCollection("counters");

  // a supergroup's own id stands for its economy, whose id the pool and
  // every voucher carry (lib/chat-ids.js)
  const chatId = await resolveEconomyChatId(requestedChatId, chatsCol);
  const chat = await chatsCol.findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (!chat.jetton_master) {
    return Response.json({ error: "this chat has no jetton configured yet" }, { status: 400 });
  }

  // Claim rules set by the chat creator: the backend does not sign outside
  // the claim window, while claims are paused, or for points still maturing.
  const settings = claimSettingsOf(chat);
  const gate = claimGate(settings);
  if (!gate.open) {
    return Response.json(
      {
        error:
          gate.reason === "paused"
            ? "claims in this chat are paused by its admin"
            : "claims in this chat are closed today (admin's claim schedule)",
        gate,
      },
      { status: 409 },
    );
  }

  await reconcileExpiredClaims(chatId, userId);
  const record = await rewardsCol.findOne({ chat_id: chatId, user_id: userId });
  const balance = await claimablePoints(chatId, userId, record, settings);
  const points = balance.points;
  const availablePoints = balance.available;
  if (availablePoints <= 0) {
    return Response.json(
      {
        error: balance.maturing > 0 ? "your new points are still maturing" : "no claimable points",
        points,
        maturing: balance.maturing,
        next_mature_at: balance.next_mature_at,
      },
      { status: 400 },
    );
  }

  const jettonMaster = chat.jetton_master;
  let metadata;
  let pool;
  try {
    metadata = await fetchJettonMetadata(jettonMaster);
    pool = await getPoolStatus(cfg.masterAddress, chatId);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!pool.poolAddress || !pool.active) {
    return Response.json({ error: "pool is not activated yet; ask the chat creator to activate it" }, { status: 409 });
  }
  if (metadata.decimals === null) {
    // never guess: a wrong decimals value scales the payout by 10^difference
    return Response.json({ error: "cannot read this jetton's decimals right now, try again later" }, { status: 502 });
  }

  // Size the claim to what the pool can pay right now: its ledger and the
  // admin's daily claim budget (the leaked-key safety cap). A claim above
  // either would fail on-chain after the user paid gas, so issue a partial
  // claim instead; the remaining points stay claimable.
  let payable;
  try {
    const [ledger, controls] = await Promise.all([
      fetchPoolLedgerBalance(pool.poolAddress, jettonMaster),
      fetchPoolClaimControls(pool.poolAddress, jettonMaster),
    ]);
    if (controls.paused) {
      return Response.json({ error: "claims in this chat are paused by its admin" }, { status: 409 });
    }
    payable = ledger < controls.claimableToday ? ledger : controls.claimableToday;
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }

  // The chat's prices right now - re-read after the slow RPC calls above so a
  // change saved meanwhile applies (a scheduled decrease counts from its
  // effective_at, whether or not the bot has applied it yet). The current
  // price, the price history and the maturation period all come from this one
  // read, so a concurrent save can never make one voucher value some points
  // before it and others after it. A voucher is priced once, when it is
  // signed, and keeps that amount even if the creator changes the price before
  // it is used (its points are already deducted).
  //
  // Points are valued as lots (lib/lot-pricing.js): the claim takes the
  // oldest unclaimed points, and points that were still maturing when a
  // decrease took effect keep the price from before it.
  //
  // The current price was checked against the jetton's decimals when saved,
  // but the jetton may have been unknown then or switched since: a price
  // finer than one unit would floor every payout, so refuse instead of paying
  // less than shown.
  let valuation;
  let price;
  try {
    const fresh = await chatsCol.findOne(
      { id: chatId },
      { projection: { id: 1, point_price: 1, point_price_pending: 1, point_price_history: 1, claim_settings: 1 } },
    );
    if (!fresh) return Response.json({ error: "chat not found" }, { status: 404 });
    const lots = await chatLots(fresh, [userId]);
    price = lots.timeline.current;
    if (!priceFitsDecimals(price, metadata.decimals)) {
      return Response.json(
        {
          error: `this chat's point price (${price}) is finer than its jetton's smallest unit; ask the chat creator to update it`,
        },
        { status: 409 },
      );
    }
    // Sized to what the pool can pay today: the oldest lots while they fit,
    // then as many points of the next one as fit (a partial claim; the rest
    // stays claimable).
    valuation = lots.value(record, availablePoints, metadata.decimals, { payable });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }

  const claimPointsCount = valuation.points;
  const amount = valuation.units;
  if (claimPointsCount <= 0 || amount <= 0n || amount > payable) {
    return Response.json(
      {
        error:
          payable > 0n
            ? "not enough points to claim"
            : "the chat pool has paid out its limit for today; try again tomorrow or ask the chat creator to top it up",
        points,
        available_points: availablePoints,
      },
      { status: payable > 0n ? 400 : 409 },
    );
  }

  try {
    const counter = await countersCol.findOneAndUpdate(
      { _id: `nonce_${chatId}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    const nonce = counter.seq;
    const expiry = defaultExpiry();

    const voucher = buildClaimVoucherCell({
      chatId,
      recipient,
      jettonMaster,
      amount,
      nonce,
      expiry,
    });
    const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
      tag: VOUCHER_TAG.Claim,
      target: pool.poolAddress,
    });
    const claimBody = buildClaimBody({ voucherCell: voucher, signature });

    // Authoritative balance check: the read above is only a fast path, this
    // atomic conditional update is what stops concurrent claims from issuing
    // multiple vouchers for the same points. It also requires claimed_points
    // to be exactly what the voucher was valued from: FIFO valuation priced
    // the points right after it, so a claim or release in between (which
    // would move this voucher onto other lots) makes it fail instead.
    const claimedBefore = record?.claimed_points || 0;
    const claimed = await claimPoints(chatId, userId, claimPointsCount, claimedBefore + availablePoints, claimedBefore);
    if (!claimed) {
      return Response.json(
        { error: "your points changed meanwhile (another claim?); try again", points },
        { status: 409 },
      );
    }

    try {
      await claimsCol.insertOne({
        chat_id: chatId,
        user_id: userId,
        points: claimPointsCount,
        amount: amount.toString(),
        // the current price when this voucher was sized, and what each part
        // of it was paid at (points that were still maturing when a decrease
        // took effect keep the earlier price), for payout audits
        point_price: price,
        price_breakdown: serializeBreakdown(valuation.breakdown),
        nonce,
        recipient: recipient.toString(),
        jetton_master: jettonMaster,
        // the pool that pays it: a later redeploy changes the chat's pool,
        // and settling this claim must still ask this one (lib/rewards.js)
        pool_address: pool.poolAddress.toString(),
        expiry: Number(expiry),
        status: "issued",
        created_at: nowSeconds(),
      });
    } catch (e) {
      // No claim record means no voucher was handed out; credit back exactly
      // what this request deducted (concurrent claims are independently
      // guarded by the same $expr invariant, so the ledger stays correct).
      await rewardsCol.updateOne(
        { chat_id: chatId, user_id: userId },
        { $inc: { claimed_points: -claimPointsCount } },
      );
      throw e;
    }

    return Response.json({
      ok: true,
      to: pool.poolAddress.toString(),
      amount: GAS.claimTon,
      payload_b64: claimBody.toBoc().toString("base64"),
      nonce,
      points: claimPointsCount,
      remaining_points: availablePoints - claimPointsCount,
      jettons: formatUnits(amount, metadata.decimals),
      decimals: metadata.decimals,
      point_price: price,
      // [{ price, points, jettons }]: more than one entry when some points
      // keep the price from before a decrease
      price_breakdown: valuation.breakdown.map((b) => ({
        price: b.price,
        points: b.points,
        jettons: formatUnits(b.units, metadata.decimals),
      })),
      expiry: Number(expiry),
    });
  } catch (e) {
    return Response.json({ error: `claim build failed: ${e.message}` }, { status: 502 });
  }
}
