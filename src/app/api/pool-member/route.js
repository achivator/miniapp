import { getCollection } from "@/lib/mongo";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import { chatPointsToUnits } from "@/lib/point-price";
import { claimSettingsOf, claimablePoints } from "@/lib/claim-rules";
import { nowSeconds, reconcileExpiredClaims } from "@/lib/rewards";
import {
  claimState,
  errorResponse,
  httpError,
  memberProfiles,
  requireChatCreator,
  sameAddress,
  serializeSummary,
  summarizeClaims,
} from "@/lib/pool-members";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 100;
const WEEK = 7 * 86400;

// One member's account in the creator's chat: balance breakdown, payout
// history, where the points came from (grants and who reacted), achievements.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = Number(searchParams.get("chatId"));
    const userId = Number(searchParams.get("userId"));
    const { chat } = await requireChatCreator(request, chatId);
    if (!Number.isSafeInteger(userId)) throw httpError(400, "userId is required");

    // Same reconciliation the member's own screen runs: settles lapsed
    // vouchers against the chain so "unconfirmed" payouts become paid or
    // released before the admin reads the history.
    await reconcileExpiredClaims(chatId, userId);

    const now = nowSeconds();
    const settings = claimSettingsOf(chat);
    const record = await (await getCollection("rewards")).findOne({ chat_id: chatId, user_id: userId });
    if (!record) throw httpError(404, "this member has no rewards in the chat");

    const reactionsCol = await getCollection("reaction_points");
    const grantsCol = await getCollection("grants");
    const [balance, claims, grants, grantTotals, reactionTotals, topReactors, achievements] = await Promise.all([
      claimablePoints(chatId, userId, record, settings),
      (await getCollection("claims")).find({ chat_id: chatId, user_id: userId }).sort({ created_at: -1 }).toArray(),
      grantsCol.find({ chat_id: chatId, user_id: userId }).sort({ date: -1 }).limit(HISTORY_LIMIT).toArray(),
      grantsCol
        .aggregate([{ $match: { chat_id: chatId, user_id: userId } }, { $group: { _id: null, points: { $sum: "$points" } } }])
        .toArray(),
      reactionsCol
        .aggregate([
          { $match: { chat_id: chatId, receiver_id: userId } },
          {
            $group: {
              _id: null,
              points: { $sum: "$points" },
              count: { $sum: 1 },
              week: { $sum: { $cond: [{ $gt: ["$date", new Date((now - WEEK) * 1000)] }, "$points", 0] } },
            },
          },
        ])
        .toArray(),
      // Who the points come from: a handful of accounts feeding one member
      // most of their points is what reaction farming looks like.
      reactionsCol
        .aggregate([
          { $match: { chat_id: chatId, receiver_id: userId } },
          { $group: { _id: "$reactor_id", points: { $sum: "$points" }, count: { $sum: 1 }, last: { $max: "$date" } } },
          { $sort: { points: -1 } },
          { $limit: 5 },
        ])
        .toArray(),
      (await getCollection("achievements")).find({ chat_id: chatId, user_id: userId }).sort({ date: -1 }).toArray(),
    ]);

    // Every jetton a claim was paid in (a chat can switch jettons).
    const masters = [...new Set([chat.jetton_master, ...claims.map((c) => c.jetton_master)].filter(Boolean))];
    const metadata = new Map(await Promise.all(masters.map(async (m) => [m, await fetchJettonMetadata(m)])));
    const jettonOf = (master) => {
      const meta = metadata.get(master);
      return { master, symbol: meta?.symbol ?? null, decimals: meta?.decimals ?? null };
    };

    const profiles = await memberProfiles(chatId, [
      userId,
      ...grants.map((g) => g.granted_by).filter(Number.isSafeInteger),
      ...topReactors.map((r) => r._id),
    ]);
    const person = (id) => ({ user_id: id, name: profiles.get(id)?.name ?? null, username: profiles.get(id)?.username ?? null });

    const current = chat.jetton_master ? jettonOf(chat.jetton_master) : null;
    const owed = Math.max(0, balance.points - (record.claimed_points || 0));
    const toUnits = (points) =>
      current && current.decimals !== null ? chatPointsToUnits(chat, points, current.decimals).toString() : null;
    const reactions = reactionTotals[0] || { points: 0, count: 0, week: 0 };

    return Response.json({
      ok: true,
      chat_id: chatId,
      title: chat.title || null,
      jetton: current,
      member: { ...person(userId), status: profiles.get(userId)?.status ?? null },
      balance: {
        points: balance.points,
        claimed_points: record.claimed_points || 0,
        owed_points: owed,
        owed_units: toUnits(owed),
        maturing_points: balance.maturing,
        next_mature_at: balance.next_mature_at,
        available_points: balance.available,
        available_units: toUnits(balance.available),
        maturation_days: settings.maturation_days,
      },
      sources: {
        reaction_points: reactions.points,
        reactions: reactions.count,
        reaction_points_week: reactions.week,
        grant_points: grantTotals[0]?.points || 0,
        top_reactors: topReactors.map((r) => ({
          ...person(r._id),
          points: r.points,
          reactions: r.count,
          last_at: r.last ? Math.floor(new Date(r.last).getTime() / 1000) : null,
        })),
      },
      payouts: serializeSummary(summarizeClaims(claims, chat.jetton_master, now)),
      claims: claims.slice(0, HISTORY_LIMIT).map((c) => ({
        nonce: c.nonce,
        state: claimState(c, now),
        points: c.points,
        amount: c.amount,
        jetton: jettonOf(c.jetton_master),
        current_jetton: sameAddress(c.jetton_master, chat.jetton_master),
        recipient: c.recipient,
        created_at: c.created_at,
        resolved_at: c.resolved_at || null,
        expiry: c.expiry,
      })),
      grants: grants.map((g) => ({
        points: g.points,
        reason: g.reason || null,
        source: g.source || null,
        granted_by: Number.isSafeInteger(g.granted_by) ? person(g.granted_by) : null,
        date: Math.floor(Number(g.date) / 1000),
      })),
      achievements: achievements.map((a) => ({
        _id: String(a._id),
        type: a.type,
        collection: a.collection || "v1",
        date: Math.floor(Number(a.date) / 1000),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
