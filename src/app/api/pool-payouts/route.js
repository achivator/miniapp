import { getCollection } from "@/lib/mongo";
import { fetchJettonMetadata } from "@/lib/ton/rpc";
import { nowSeconds } from "@/lib/rewards";
import { claimState, errorResponse, memberProfiles, requireChatCreator, sameAddress } from "@/lib/pool-members";
import { queryInt } from "@/lib/query";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

// Chat-wide payout feed for the creator, newest first. Paged by a
// created_at/nonce cursor (`before`): nonces are unique per chat, so the pair
// is a stable order even when several claims share a second.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    // a supergroup's id resolves to its economy's (lib/chat-ids.js)
    const { chat } = await requireChatCreator(request, queryInt(searchParams, "chatId"));
    const chatId = chat.id;

    const filter = { chat_id: chatId };
    const before = /^(\d+):(\d+)$/.exec(searchParams.get("before") || "");
    if (before) {
      const [createdAt, nonce] = [Number(before[1]), Number(before[2])];
      filter.$or = [{ created_at: { $lt: createdAt } }, { created_at: createdAt, nonce: { $lt: nonce } }];
    }
    // The feed is about money that moved or may still move: released
    // vouchers are noise unless asked for.
    if (searchParams.get("all") !== "1") filter.status = { $ne: "expired" };

    const rows = await (await getCollection("claims"))
      .find(filter)
      .sort({ created_at: -1, nonce: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    const page = rows.slice(0, PAGE_SIZE);

    const masters = [...new Set(page.map((c) => c.jetton_master).filter(Boolean))];
    const [metadata, profiles] = await Promise.all([
      Promise.all(masters.map(async (m) => [m, await fetchJettonMetadata(m)])).then((e) => new Map(e)),
      memberProfiles(
        chat,
        page.map((c) => c.user_id),
      ),
    ]);

    const now = nowSeconds();
    const last = page[page.length - 1];
    return Response.json({
      ok: true,
      chat_id: chatId,
      next: rows.length > PAGE_SIZE && last ? `${last.created_at}:${last.nonce}` : null,
      payouts: page.map((c) => ({
        nonce: c.nonce,
        state: claimState(c, now),
        user_id: c.user_id,
        name: profiles.get(c.user_id)?.name ?? null,
        username: profiles.get(c.user_id)?.username ?? null,
        points: c.points,
        amount: c.amount,
        jetton: {
          master: c.jetton_master,
          symbol: metadata.get(c.jetton_master)?.symbol ?? null,
          decimals: metadata.get(c.jetton_master)?.decimals ?? null,
        },
        current_jetton: sameAddress(c.jetton_master, chat.jetton_master),
        recipient: c.recipient,
        created_at: c.created_at,
        resolved_at: c.resolved_at || null,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
