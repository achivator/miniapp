import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";

export const dynamic = "force-dynamic";

// The caller's own achievements, grouped by chat. The user id comes from the
// validated Telegram init data, never from the query string.
export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const achievements = await (await getCollection("achievements"))
    .find({ user_id: auth.user.id })
    .sort({ date: -1 })
    .toArray();

  const byChat = new Map();
  for (const achievement of achievements) {
    const list = byChat.get(achievement.chat_id) || [];
    list.push(achievement);
    byChat.set(achievement.chat_id, list);
  }
  const chats = byChat.size
    ? await (await getCollection("chats")).find({ id: { $in: [...byChat.keys()] } }).toArray()
    : [];
  const titles = new Map(chats.map((chat) => [chat.id, chat.title || null]));

  return Response.json(
    [...byChat.entries()].map(([chatId, list]) => ({
      chat: { id: chatId, title: titles.get(chatId) ?? null },
      achievements: list.map((a) => ({
        _id: String(a._id),
        type: a.type,
        collection: a.collection || "v1",
        date: a.date,
      })),
    })),
  );
}
