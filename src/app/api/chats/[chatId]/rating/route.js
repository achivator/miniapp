import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMember } from "@/lib/telegram";
import {
  DEFAULT_LIMIT,
  achieversPipeline,
  canSeeRating,
  medalsByUser,
  publicEntry,
  publicName,
  rankMembers,
} from "@/lib/rating";

export const dynamic = "force-dynamic";

function fail(status, error) {
  return Response.json({ error }, { status });
}

// The chat's achievement rating (lib/rating.js): its top members by
// achievements, and the caller's own place when it is below them. Only the
// chat's members see it.
export async function GET(request, { params }) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return fail(e.status || 401, e.message);
  }
  const userId = auth.user.id;
  const chatId = Number((await params).chatId);
  if (!Number.isSafeInteger(chatId)) return fail(400, "chatId is required");

  const [achievementsCol, rewardsCol, chatsCol, usersCol] = await Promise.all(
    ["achievements", "rewards", "chats", "users"].map((name) => getCollection(name)),
  );

  // Membership before anything else, so a non-member learns nothing about
  // the chat (not even whether the bot knows it).
  const [reward, achievement, member] = await Promise.all([
    rewardsCol.findOne({ chat_id: chatId, user_id: userId }, { projection: { _id: 1 } }),
    achievementsCol.findOne({ chat_id: chatId, user_id: userId }, { projection: { _id: 1 } }),
    getChatMember(chatId, userId),
  ]);
  if (!canSeeRating({ status: member?.status ?? null, hasRecord: Boolean(reward || achievement) })) {
    return fail(403, "only members of this chat can see its rating");
  }

  const chat = await chatsCol.findOne({ id: chatId }, { projection: { title: 1 } });
  if (!chat) return fail(404, "chat not found");

  const rows = await achievementsCol.aggregate(achieversPipeline(chatId)).toArray();
  const achieverIds = rows.map((row) => row._id);
  // Points only break ties between equal medal counts; they never leave the server.
  const rewards = achieverIds.length
    ? await rewardsCol
        .find({ chat_id: chatId, user_id: { $in: achieverIds } }, { projection: { _id: 0, user_id: 1, points: 1 } })
        .toArray()
    : [];
  const points = new Map(rewards.map((r) => [r.user_id, r.points || 0]));

  const { total, top, me } = rankMembers(rows, points, { userId, limit: DEFAULT_LIMIT });
  const shown = me ? [...top, me] : top;
  const ids = shown.map((m) => m.user_id);

  // Names from the bot's record of the people it has seen (one indexed read);
  // Telegram (cached) only for whoever it has no name for.
  const [medalDocs, known] = ids.length
    ? await Promise.all([
        achievementsCol
          .find({ chat_id: chatId, user_id: { $in: ids } }, { projection: { _id: 0, user_id: 1, type: 1, collection: 1, date: 1 } })
          .toArray(),
        usersCol.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, first_name: 1, username: 1 } }).toArray(),
      ])
    : [[], []];
  const names = new Map(known.map((u) => [u.id, publicName(u)]));
  const missing = ids.filter((id) => !names.get(id));
  await Promise.all(
    missing.map(async (id) => {
      const profile = await getChatMember(chatId, id);
      names.set(id, publicName(profile?.user));
    }),
  );
  const medals = medalsByUser(medalDocs);
  const entry = (m) => publicEntry(m, { names, medals, userId });

  return Response.json({
    ok: true,
    chat: { id: chatId, title: chat.title || null },
    total,
    limit: DEFAULT_LIMIT,
    top: top.map(entry),
    // the caller's row when it is below the top; null when in it or unrated
    me: me ? entry(me) : null,
  });
}
