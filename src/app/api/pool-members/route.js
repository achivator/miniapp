import { getCollection } from "@/lib/mongo";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import { pointPriceFor } from "@/lib/point-price";
import { chatDebt, chatLots } from "@/lib/lots";
import { claimSettingsOf } from "@/lib/claim-rules";
import { nowSeconds } from "@/lib/rewards";
import {
  errorResponse,
  maturingByUser,
  memberProfiles,
  requireChatCreator,
  serializeSummary,
  summarizeClaims,
} from "@/lib/pool-members";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const SORTS = {
  earned: { points: -1, user_id: 1 },
  owed: { owed: -1, user_id: 1 },
  claimed: { claimed_points: -1, user_id: 1 },
};

// The chat creator's view of every member account: earned, claimed, still
// owed, maturing, plus chat-wide totals (what the pool owes vs. paid out).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = Number(searchParams.get("chatId"));
    const { chat } = await requireChatCreator(request, chatId);

    const sort = SORTS[searchParams.get("sort")] ? searchParams.get("sort") : "earned";
    const offset = Math.max(0, Math.min(Number(searchParams.get("offset")) || 0, 100000));
    const query = (searchParams.get("q") || "").trim();
    const userFilter = /^\d+$/.test(query) ? { user_id: Number(query) } : {};

    const now = nowSeconds();
    const settings = claimSettingsOf(chat);
    const rewardsCol = await getCollection("rewards");
    const claimsCol = await getCollection("claims");

    const owedExpr = { $max: [0, { $subtract: [{ $ifNull: ["$points", 0] }, { $ifNull: ["$claimed_points", 0] }] }] };
    const [rows, totalsRows, chatClaims, metadata] = await Promise.all([
      rewardsCol
        .aggregate([
          { $match: { chat_id: chatId, ...userFilter } },
          { $addFields: { owed: owedExpr } },
          { $sort: SORTS[sort] },
          { $skip: offset },
          { $limit: PAGE_SIZE + 1 },
        ])
        .toArray(),
      rewardsCol
        .aggregate([
          { $match: { chat_id: chatId } },
          {
            $group: {
              _id: null,
              members: { $sum: 1 },
              points: { $sum: { $ifNull: ["$points", 0] } },
              claimed_points: { $sum: { $ifNull: ["$claimed_points", 0] } },
              owed: { $sum: owedExpr },
            },
          },
        ])
        .toArray(),
      claimsCol
        .find({ chat_id: chatId }, { projection: { points: 1, amount: 1, status: 1, expiry: 1, jetton_master: 1 } })
        .toArray(),
      chat.jetton_master ? fetchJettonMetadata(chat.jetton_master) : Promise.resolve(null),
    ]);

    const page = rows.slice(0, PAGE_SIZE);
    const userIds = page.map((r) => r.user_id);
    const [memberClaims, maturing, profiles, achievementCounts] = await Promise.all([
      userIds.length
        ? claimsCol
            .find(
              { chat_id: chatId, user_id: { $in: userIds } },
              { projection: { user_id: 1, points: 1, amount: 1, status: 1, expiry: 1, jetton_master: 1, created_at: 1 } },
            )
            .toArray()
        : [],
      maturingByUser(chatId, userIds, settings.maturation_days, now),
      memberProfiles(chatId, userIds),
      userIds.length
        ? (await getCollection("achievements"))
            .aggregate([
              { $match: { chat_id: chatId, user_id: { $in: userIds } } },
              { $group: { _id: "$user_id", count: { $sum: 1 } } },
            ])
            .toArray()
        : [],
    ]);

    const claimsByUser = new Map();
    for (const claim of memberClaims) {
      const list = claimsByUser.get(claim.user_id) || [];
      list.push(claim);
      claimsByUser.set(claim.user_id, list);
    }
    const achievementsByUser = new Map(achievementCounts.map((row) => [row._id, row.count]));

    // Valued like a claim (lib/lot-pricing.js): oldest points first, points
    // that were still maturing when a decrease took effect at the price from
    // before it. One read of every member's lots serves the page and the
    // chat total. null without a jetton or its decimals.
    const decimals = metadata?.decimals ?? null;
    const valued = chat.jetton_master && decimals !== null;
    const lots = valued ? await chatLots(chat, null) : null;
    const debt = valued ? await chatDebt(chat, decimals, new Date(), lots) : null;
    const owedUnits = (record) => (valued ? lots.owed(record, decimals).units.toString() : null);

    const totals = totalsRows[0] || { members: 0, points: 0, claimed_points: 0, owed: 0 };

    return Response.json({
      ok: true,
      chat_id: chatId,
      title: chat.title || null,
      jetton: chat.jetton_master
        ? { master: chat.jetton_master, symbol: metadata?.symbol ?? null, decimals }
        : null,
      jettons_per_point: pointPriceFor(chat),
      maturation_days: settings.maturation_days,
      totals: {
        members: totals.members,
        points: totals.points,
        claimed_points: totals.claimed_points,
        // what the pool still owes if everyone claimed everything (matured or not)
        owed_points: totals.owed,
        owed_units: debt ? debt.units.toString() : null,
        payouts: serializeSummary(summarizeClaims(chatClaims, chat.jetton_master, now)),
      },
      sort,
      offset,
      has_more: rows.length > PAGE_SIZE,
      members: page.map((r) => {
        const profile = profiles.get(r.user_id);
        const claims = claimsByUser.get(r.user_id) || [];
        const points = r.points || 0;
        const claimed = r.claimed_points || 0;
        const maturingPoints = maturing.get(r.user_id) || 0;
        const lastClaim = claims.reduce((max, c) => Math.max(max, c.created_at || 0), 0);
        return {
          user_id: r.user_id,
          name: profile?.name ?? null,
          username: profile?.username ?? null,
          status: profile?.status ?? null,
          points,
          claimed_points: claimed,
          owed_points: r.owed,
          owed_units: owedUnits(r),
          maturing_points: maturingPoints,
          available_points: Math.max(0, points - claimed - maturingPoints),
          achievements: achievementsByUser.get(r.user_id) || 0,
          last_claim_at: lastClaim || null,
          payouts: serializeSummary(summarizeClaims(claims, chat.jetton_master, now)),
        };
      }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
