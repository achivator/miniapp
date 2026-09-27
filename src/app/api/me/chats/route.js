import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import { pointsToJettons, formatUnits } from "@/lib/ton/amounts";
import { reconcileExpiredClaims } from "@/lib/rewards";
import { claimGate, claimSettingsOf, claimablePoints } from "@/lib/claim-rules";

export const dynamic = "force-dynamic";

export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }
  const userId = auth.user.id;
  const cfg = getTonConfig();

  const chatsCol = await getCollection("chats");
  const rewardsCol = await getCollection("rewards");
  const claimsCol = await getCollection("claims");
  const grantsCol = await getCollection("grants");

  const myRewards = await rewardsCol.find({ user_id: userId }).toArray();
  const rewardChatIds = myRewards.map((r) => r.chat_id);
  const rewardChats = rewardChatIds.length
    ? await chatsCol.find({ id: { $in: rewardChatIds } }).toArray()
    : [];
  const chatById = new Map(rewardChats.map((c) => [c.id, c]));

  const myGrants = rewardChatIds.length
    ? await grantsCol
        .find({ chat_id: { $in: rewardChatIds }, user_id: userId })
        .sort({ date: -1 })
        .limit(50)
        .toArray()
    : [];
  const grantsByChat = new Map();
  for (const grant of myGrants) {
    const list = grantsByChat.get(grant.chat_id) || [];
    list.push(grant);
    grantsByChat.set(grant.chat_id, list);
  }

  const rewards = [];
  for (const record of myRewards) {
    const chat = chatById.get(record.chat_id);
    const points = record.points || 0;

    await reconcileExpiredClaims(record.chat_id, userId);
    const fresh = await rewardsCol.findOne({ _id: record._id });
    const settings = claimSettingsOf(chat);
    const balance = await claimablePoints(record.chat_id, userId, fresh, settings);
    const availablePoints = balance.available;

    let decimals = null;
    let symbol = null;
    if (chat?.jetton_master) {
      const metadata = await fetchJettonMetadata(chat.jetton_master);
      decimals = metadata.decimals;
      symbol = metadata.symbol;
    }

    const pendingClaims = await claimsCol
      .find({ chat_id: record.chat_id, user_id: userId, status: "issued", expiry: { $gt: Math.floor(Date.now() / 1000) } })
      .toArray();

    rewards.push({
      chat_id: record.chat_id,
      title: chat?.title || null,
      jetton_master: chat?.jetton_master || null,
      decimals,
      symbol,
      points,
      available_points: availablePoints,
      maturing_points: balance.maturing,
      next_mature_at: balance.next_mature_at,
      maturation_days: settings.maturation_days,
      claim_gate: claimGate(settings),
      // null when the jetton or its decimals are unknown: never show a guess
      jettons:
        chat?.jetton_master && decimals !== null
          ? formatUnits(pointsToJettons(availablePoints, cfg.jettonsPerPoint, decimals), decimals)
          : null,
      grants: (grantsByChat.get(record.chat_id) || []).slice(0, 3).map((g) => ({
        points: g.points,
        reason: g.reason || null,
        date: g.date,
      })),
      pending: pendingClaims.map((c) => ({
        nonce: c.nonce,
        amount: decimals !== null ? formatUnits(BigInt(c.amount), decimals) : null,
        expiry: c.expiry,
      })),
    });
  }

  const creatorChats = await chatsCol.find({ creator: userId }).toArray();

  return Response.json({
    ok: true,
    dev: auth.dev,
    config: {
      network: cfg.network,
      master_address: cfg.masterAddress,
      jettons_per_point: cfg.jettonsPerPoint,
    },
    rewards,
    creator: creatorChats.map((c) => ({
      chat_id: c.id,
      title: c.title || null,
      jetton_master: c.jetton_master || null,
    })),
  });
}
