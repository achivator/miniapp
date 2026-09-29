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

export const dynamic = "force-dynamic";

export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = Number(searchParams.get("chatId"));
  if (!Number.isSafeInteger(chatId)) {
    return Response.json({ error: "chatId is required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress) {
    return Response.json({ error: "MASTER_ADDRESS is not configured" }, { status: 500 });
  }

  const chatsCol = await getCollection("chats");
  const chat = await chatsCol.findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });

  const isCreator = chat.creator === auth.user.id;
  const memberCount = await getChatMemberCount(chatId);

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
    } catch {
      ledger = null;
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
    member_count: memberCount,
    create_pool_body:
      !status.active && isCreator ? buildCreatePoolBody(chatId).toBoc().toString("base64") : null,
    create_pool_ton: GAS.createPoolTon,
    pool_reserve_ton: GAS.poolReserveTon,
  });
}
