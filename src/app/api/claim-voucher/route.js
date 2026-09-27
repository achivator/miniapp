import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { Address } from "@ton/core";
import { fetchJettonMetadata, fetchPoolClaimControls, fetchPoolLedgerBalance, getPoolStatus } from "@/lib/ton/rpc";
import { buildClaimVoucherCell, buildClaimBody, signVoucher, defaultExpiry } from "@/lib/ton/vouchers";
import { pointsToJettons, formatUnits } from "@/lib/ton/amounts";
import { GAS, VOUCHER_TAG } from "@/lib/ton/constants";
import { reconcileExpiredClaims, claimPoints, nowSeconds } from "@/lib/rewards";
import { claimGate, claimSettingsOf, claimablePoints } from "@/lib/claim-rules";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const chatId = Number(body?.chatId);
  const wallet = body?.wallet;
  if (!Number.isSafeInteger(chatId) || !wallet) {
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

  let claimPointsCount = availablePoints;
  const unitsPerPoint = pointsToJettons(1, cfg.jettonsPerPoint, metadata.decimals);
  if (unitsPerPoint > 0n && pointsToJettons(claimPointsCount, cfg.jettonsPerPoint, metadata.decimals) > payable) {
    claimPointsCount = Number(payable / unitsPerPoint);
  }
  const amount = pointsToJettons(claimPointsCount, cfg.jettonsPerPoint, metadata.decimals);
  if (amount <= 0n || amount > payable) {
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
    // multiple vouchers for the same points.
    const claimed = await claimPoints(
      chatId,
      userId,
      claimPointsCount,
      (record?.claimed_points || 0) + availablePoints,
    );
    if (!claimed) {
      return Response.json({ error: "no claimable points", points }, { status: 409 });
    }

    try {
      await claimsCol.insertOne({
        chat_id: chatId,
        user_id: userId,
        points: claimPointsCount,
        amount: amount.toString(),
        nonce,
        recipient: recipient.toString(),
        jetton_master: jettonMaster,
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
      expiry: Number(expiry),
    });
  } catch (e) {
    return Response.json({ error: `claim build failed: ${e.message}` }, { status: 502 });
  }
}
