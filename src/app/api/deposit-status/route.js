import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { resolveEconomyChatId } from "@/lib/chat-ids";
import { getTonConfig } from "@/lib/ton/config";
import { fetchJettonWalletAddress, fetchPoolAdmin, getPoolStatus } from "@/lib/ton/rpc";
import { classifyDepositTrace, externalMessageHashes, findDepositTrace } from "@/lib/ton/deposit-trace";

export const dynamic = "force-dynamic";

// What became of one submitted deposit: POST { chatId, boc, amount } with the
// BOC the wallet returned and the amount in the jetton's smallest units (the
// `jetton_amount` of /api/deposit-voucher). The answer comes from the
// transaction trace of that very message, checked against the pool, its
// jetton wallet and the admin wallet read from the chain; the pool's ledger
// is not consulted, other activity moves it too (miniapp #47).
export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const requestedChatId = Number(body?.chatId);
  const boc = body?.boc;
  const amountStr = body?.amount;
  if (!Number.isSafeInteger(requestedChatId) || typeof boc !== "string" || typeof amountStr !== "string" || !/^[0-9]+$/.test(amountStr)) {
    return Response.json({ error: "chatId, boc and amount (smallest units) are required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress) {
    return Response.json({ error: "MASTER_ADDRESS is not configured" }, { status: 500 });
  }

  const chatsCol = await getCollection("chats");
  const chatId = await resolveEconomyChatId(requestedChatId, chatsCol);
  const chat = await chatsCol.findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (chat.creator !== auth.user.id) {
    return Response.json({ error: "only the chat creator can deposit" }, { status: 403 });
  }
  if (!chat.jetton_master) {
    return Response.json({ error: "this chat has no jetton configured yet" }, { status: 400 });
  }

  let expected;
  try {
    const pool = await getPoolStatus(cfg.masterAddress, chatId);
    if (!pool.poolAddress || !pool.active) {
      return Response.json({ error: "pool is not activated yet" }, { status: 409 });
    }
    const [admin, poolJettonWallet] = await Promise.all([
      fetchPoolAdmin(pool.poolAddress),
      fetchJettonWalletAddress(chat.jetton_master, pool.poolAddress),
    ]);
    if (!admin) return Response.json({ error: "the pool has no admin yet" }, { status: 409 });
    expected = { pool: pool.poolAddress, poolJettonWallet, depositor: admin, amount: BigInt(amountStr) };
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }

  let hashes;
  try {
    hashes = externalMessageHashes(boc);
  } catch {
    return Response.json({ error: "boc is not an external message" }, { status: 400 });
  }

  let trace;
  try {
    trace = await findDepositTrace(hashes);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }

  const result = classifyDepositTrace(trace, expected);
  if (result.outcome !== "pending" && result.outcome !== "credited") {
    console.error(`chat ${chatId}: deposit ${result.outcome} (${result.reason}) pool tx ${result.poolTx ?? "-"}`);
  }
  return Response.json({
    ok: true,
    outcome: result.outcome,
    reason: result.reason,
    pool_tx: result.poolTx ?? null,
    trace_id: trace?.trace_id ?? null,
  });
}
