import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import {
  fetchJettonMetadata,
  fetchPoolClaimControls,
  fetchPoolLedgerBalance,
  getPoolStatus,
  runGetMethod,
  stackItemToAddress,
} from "@/lib/ton/rpc";
import { buildCreatePoolBody } from "@/lib/ton/vouchers";
import { GAS } from "@/lib/ton/constants";
import { getChatMemberCount } from "@/lib/telegram";
import { limitRestore } from "@/lib/payout-coverage";
import { upcomingPointPrice } from "@/lib/point-price";
import { loadPlatformDefault } from "@/lib/platform-price";
import { queryInt } from "@/lib/query";
import { resolveEconomyChatId, telegramChatId } from "@/lib/chat-ids";

export const dynamic = "force-dynamic";

export async function GET(request) {
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

  const { searchParams } = new URL(request.url);
  const requestedChatId = queryInt(searchParams, "chatId");
  if (!Number.isSafeInteger(requestedChatId)) {
    return Response.json({ error: "chatId is required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress) {
    return Response.json({ error: "MASTER_ADDRESS is not configured" }, { status: 500 });
  }

  const chatsCol = await getCollection("chats");
  // A supergroup's own id stands for its economy, the pool's id (lib/
  // chat-ids.js): the response's chat_id is the one to link to.
  const chatId = await resolveEconomyChatId(requestedChatId, chatsCol);
  const chat = await chatsCol.findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });

  const isCreator = chat.creator === auth.user.id;
  const memberCount = await getChatMemberCount(telegramChatId(chat));

  let status = { poolAddress: null, active: false, balance: 0n };
  try {
    status = await getPoolStatus(cfg.masterAddress, chatId);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }

  let jetton = null;
  if (chat.jetton_master) {
    try {
      const metadata = await fetchJettonMetadata(chat.jetton_master);
      jetton = { master: chat.jetton_master, symbol: metadata.symbol, decimals: metadata.decimals };
    } catch {
      jetton = { master: chat.jetton_master, symbol: null, decimals: null };
    }
  }

  let poolAdmin = null;
  if (status.active) {
    try {
      poolAdmin = stackItemToAddress((await runGetMethod(status.poolAddress, "poolAdmin", []))[0]);
    } catch {
      poolAdmin = null;
    }
  }

  // Jetton ledger of the pool (what members can claim), not its TON balance.
  let ledger = null;
  let controls = null;
  let onchainLimit = null;
  if (status.active && chat.jetton_master) {
    try {
      const [balance, c] = await Promise.all([
        fetchPoolLedgerBalance(status.poolAddress, chat.jetton_master),
        fetchPoolClaimControls(status.poolAddress, chat.jetton_master),
      ]);
      ledger = balance.toString();
      // safety controls: pause flag, explicit daily limit (0 = default
      // 10%/day) and what claims can still move today
      controls = { paused: c.paused, limit: c.limit.toString(), claimable_today: c.claimableToday.toString() };
      onchainLimit = c.limit;
    } catch {
      ledger = null;
    }
  }

  // A daily limit raised for a price decrease that is now behind: the
  // creator is asked to set it back (lib/payout-coverage.js limitRestore).
  let limitRestoreView = null;
  if (isCreator && chat.claim_limit_raise) {
    let upcoming = false;
    try {
      upcoming = upcomingPointPrice(chat) !== null;
    } catch {
      upcoming = false;
    }
    const restore = limitRestore(chat.claim_limit_raise, {
      jettonMaster: chat.jetton_master || null,
      limit: onchainLimit,
      upcoming,
    });
    if (restore?.state === "clear") {
      // back at or below the original (or obsolete): done. Conditional, so a
      // raise recorded meanwhile stays.
      await chatsCol
        .updateOne(
          { id: chatId, "claim_limit_raise.requested_at": chat.claim_limit_raise.requested_at ?? null },
          { $unset: { claim_limit_raise: "" } },
        )
        .catch((e) => console.error("pool-status: clearing claim_limit_raise failed", chatId, e));
    } else if (restore?.state === "due") {
      limitRestoreView = { from: restore.from, to: restore.to, effective_at: restore.effective_at };
    }
  }

  // Whether the chat hears the bot's announcements (price changes, the
  // jetton switch): the bot flags a chat it cannot post in
  // (chats.bot_cannot_post_at / _reason). A group upgraded to a supergroup
  // is posted to under its telegram id, so the flag that matters is that
  // chat's. Its economy (points, pool, settings) stays under this id: the
  // supergroup earns into it, unless it had money of its own and an
  // operator has to review the move (needs_review).
  let botCannotPost = null;
  let migrated = null;
  if (isCreator) {
    let target = chat;
    const tgChatId = telegramChatId(chat);
    if (tgChatId !== chat.id) {
      migrated = {
        to_chat_id: tgChatId,
        at: chat.migrated_at ? Math.floor(new Date(chat.migrated_at).getTime() / 1000) : null,
        needs_review: chat.migration_needs_review === true,
      };
      target = await chatsCol
        .findOne({ id: tgChatId }, { projection: { bot_cannot_post_at: 1, bot_cannot_post_reason: 1 } })
        .catch(() => null);
    }
    if (target?.bot_cannot_post_at) {
      botCannotPost = {
        at: Math.floor(new Date(target.bot_cannot_post_at).getTime() / 1000),
        reason: target.bot_cannot_post_reason || null,
      };
    }
  }

  return Response.json({
    ok: true,
    chat_id: chatId,
    title: chat.title || null,
    jetton_master: chat.jetton_master || null,
    jetton,
    is_creator: isCreator,
    master_address: cfg.masterAddress,
    network: cfg.network,
    pool_address: status.poolAddress ? status.poolAddress.toString() : null,
    active: status.active,
    ton_balance: status.balance.toString(),
    ledger,
    pool_admin: poolAdmin ? poolAdmin.toString() : null,
    controls,
    // { from, to, effective_at }: set the daily limit back to `from`, or null
    limit_restore: limitRestoreView,
    // creator only: { at, reason } when the bot cannot post in the chat, and
    // { to_chat_id, at, needs_review } when it became a supergroup
    bot_cannot_post: botCannotPost,
    migrated,
    member_count: memberCount,
    create_pool_body:
      !status.active && isCreator ? buildCreatePoolBody(chatId).toBoc().toString("base64") : null,
    create_pool_ton: GAS.createPoolTon,
    pool_reserve_ton: GAS.poolReserveTon,
  });
}
