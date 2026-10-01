import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { resolveEconomyChatId } from "@/lib/chat-ids";

export const dynamic = "force-dynamic";

// Body: { chatId }. The creator dismisses the pool page's "set the daily
// limit back" banner (chats.claim_limit_raise, see lib/payout-coverage.js)
// without changing the limit: they keep it raised on purpose. Off-chain.
export async function POST(request) {
  try {
    const auth = authenticate(request);
    const body = await request.json().catch(() => null);
    const requestedChatId = Number(body?.chatId);
    if (!Number.isSafeInteger(requestedChatId)) return Response.json({ error: "chatId is required" }, { status: 400 });
    const chats = await getCollection("chats");
    // a supergroup's own id stands for its economy (lib/chat-ids.js)
    const chatId = await resolveEconomyChatId(requestedChatId, chats);
    const chat = await chats.findOne({ id: chatId });
    if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
    if (chat.creator !== auth.user.id) {
      return Response.json({ error: "only the chat creator can manage the pool" }, { status: 403 });
    }
    await chats.updateOne({ id: chatId }, { $unset: { claim_limit_raise: "" } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
