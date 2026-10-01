import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getChatMember } from "@/lib/telegram";
import { resolveEconomyChatId, telegramChatId } from "@/lib/chat-ids";
import {
  PHOTO_MAX_AGE_S,
  canSeeChatPhoto,
  chatPhotoImage,
  chatProfile,
  etagOf,
  isNotModified,
} from "@/lib/chat-photo";

export const dynamic = "force-dynamic";

function fail(status, error) {
  return Response.json({ error }, { status });
}

// The chat's photo (its small one), for the chat's members and its creator
// (lib/chat-photo.js). Proxied: Telegram's download URL carries the bot
// token. The ETag is the photo's file_unique_id; a browser that has it gets
// 304. A chat without a photo, or one Telegram no longer answers for (the
// bot was removed, the chat is gone), is a 404.
export async function GET(request, { params }) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return fail(e.status || 401, e.message);
  }
  const userId = auth.user.id;
  const requestedChatId = Number((await params).chatId);
  if (!Number.isSafeInteger(requestedChatId)) return fail(400, "chatId is required");

  const [achievementsCol, rewardsCol, chatsCol] = await Promise.all(
    ["achievements", "rewards", "chats"].map((name) => getCollection(name)),
  );
  // a supergroup's own id stands for its economy (lib/chat-ids.js); Telegram
  // is asked about the chat where it knows it now
  const chatId = await resolveEconomyChatId(requestedChatId, chatsCol);
  const chat = await chatsCol.findOne(
    { id: chatId },
    { projection: { _id: 0, id: 1, title: 1, creator: 1, telegram_chat_id: 1, migrated_to_chat_id: 1 } },
  );
  const tgChatId = telegramChatId(chat) ?? chatId;

  // Membership first, the rating's rule, so a non-member learns nothing
  // about the chat (not even whether the bot knows it).
  const [reward, achievement, member] = await Promise.all([
    rewardsCol.findOne({ chat_id: chatId, user_id: userId }, { projection: { _id: 1 } }),
    achievementsCol.findOne({ chat_id: chatId, user_id: userId }, { projection: { _id: 1 } }),
    getChatMember(tgChatId, userId),
  ]);
  const allowed = canSeeChatPhoto({
    status: member?.status ?? null,
    hasRecord: Boolean(reward || achievement),
    isCreator: chat?.creator != null && chat.creator === userId,
  });
  if (!allowed) return fail(403, "only members of this chat can see its photo");
  if (!chat) return fail(404, "chat not found");

  let profile = null;
  try {
    profile = await chatProfile(chat, chatsCol);
  } catch {
    profile = null;
  }
  if (!profile?.photo) return fail(404, "this chat has no photo");

  const headers = {
    ETag: etagOf(profile.photo.unique_id),
    "Cache-Control": `private, max-age=${PHOTO_MAX_AGE_S}`,
  };
  if (isNotModified(request.headers.get("if-none-match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }

  let image = null;
  try {
    image = await chatPhotoImage(profile.photo);
  } catch {
    image = null;
  }
  if (!image) return fail(404, "this chat has no photo");
  return new Response(image.bytes, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": image.type,
      "Content-Length": String(image.bytes.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
