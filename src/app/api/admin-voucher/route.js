import { Address } from "@ton/core";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { getPoolStatus, runGetMethod, stackItemToAddress } from "@/lib/ton/rpc";
import { buildAdminVoucherCell, buildSetAdminBody, signVoucher, defaultExpiry } from "@/lib/ton/vouchers";
import { GAS, SECONDS, VOUCHER_TAG } from "@/lib/ton/constants";
import { getChatMemberStatus } from "@/lib/telegram";
import { resolveEconomyChatId, telegramChatId } from "@/lib/chat-ids";

export const dynamic = "force-dynamic";

// Signs an AdminInitVoucher that lets the chat creator's connected wallet
// claim the empty admin slot of the chat pool (the slot controls
// WithdrawRemainder). The contract only accepts it from that same wallet, so
// a leaked voucher is useless to anyone else; rotation to a successor is a
// separate, current-admin-signed flow and is not served here.
export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const requestedChatId = Number(body?.chatId);
  let wallet;
  try {
    wallet = Address.parse(String(body?.wallet || ""));
  } catch {
    return Response.json({ error: "chatId and a valid wallet are required" }, { status: 400 });
  }
  if (!Number.isSafeInteger(requestedChatId)) {
    return Response.json({ error: "chatId and a valid wallet are required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress || !process.env.BACKEND_SECRET) {
    return Response.json({ error: "backend is not configured" }, { status: 500 });
  }

  // a supergroup's own id stands for its economy, whose id the pool and
  // every voucher carry (lib/chat-ids.js)
  const chatId = await resolveEconomyChatId(requestedChatId);
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat || chat.creator !== auth.user.id) {
    return Response.json({ error: "only the chat creator can manage the pool" }, { status: 403 });
  }
  // The stored creator flag can be stale (ownership transfer); the admin slot
  // is long-lived, so confirm with Telegram right now.
  if ((await getChatMemberStatus(telegramChatId(chat), auth.user.id)) !== "creator") {
    return Response.json({ error: "Telegram does not confirm you as the chat creator" }, { status: 403 });
  }

  let pool;
  let currentAdmin = null;
  try {
    pool = await getPoolStatus(cfg.masterAddress, chatId);
    if (pool.active) currentAdmin = stackItemToAddress((await runGetMethod(pool.poolAddress, "poolAdmin", []))[0]);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!pool.poolAddress || !pool.active) {
    return Response.json({ error: "pool is not activated yet" }, { status: 409 });
  }
  if (currentAdmin) {
    return Response.json(
      {
        error: currentAdmin.equals(wallet)
          ? "this wallet is already the pool admin"
          : "the pool already has an admin wallet; hand over from that wallet",
        admin: currentAdmin.toString(),
      },
      { status: 409 },
    );
  }

  const expiry = defaultExpiry(SECONDS.adminVoucherTtl);
  const voucher = buildAdminVoucherCell({ chatId, master: cfg.masterAddress, admin: wallet, expiry });
  const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
    tag: VOUCHER_TAG.Admin,
    target: pool.poolAddress,
  });

  return Response.json({
    ok: true,
    to: pool.poolAddress.toString(),
    amount: GAS.setAdminTon,
    payload_b64: buildSetAdminBody({ voucherCell: voucher, signature }).toBoc().toString("base64"),
    expiry: Number(expiry),
  });
}
