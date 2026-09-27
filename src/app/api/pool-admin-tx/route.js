import { Address } from "@ton/core";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchJettonMetadata, getPoolStatus } from "@/lib/ton/rpc";
import {
  buildSetClaimLimitBody,
  buildSetClaimsPausedBody,
  buildWithdrawRemainderBody,
} from "@/lib/ton/vouchers";
import { parseUnits } from "@/lib/ton/amounts";
import { GAS } from "@/lib/ton/constants";

export const dynamic = "force-dynamic";

// Builds the pool admin's own transactions: withdraw, pause/resume claims,
// daily claim limit. Nothing is signed here - the pool only obeys its admin
// wallet - this keeps the message layouts in one place (lib/ton/vouchers.js).
export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const chatId = Number(body?.chatId);
  const action = String(body?.action || "");
  if (!Number.isSafeInteger(chatId) || !["withdraw", "pause", "resume", "limit"].includes(action)) {
    return Response.json({ error: "chatId and a valid action are required" }, { status: 400 });
  }

  const cfg = getTonConfig();
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (chat.creator !== auth.user.id) {
    return Response.json({ error: "only the chat creator can manage the pool" }, { status: 403 });
  }

  let pool;
  try {
    pool = await getPoolStatus(cfg.masterAddress, chatId);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!pool.active) return Response.json({ error: "pool is not activated yet" }, { status: 409 });

  const tx = (payload, amount = GAS.adminControlTon) =>
    Response.json({ ok: true, to: pool.poolAddress.toString(), amount, payload_b64: payload.toBoc().toString("base64") });

  if (action === "pause" || action === "resume") return tx(buildSetClaimsPausedBody(action === "pause"));

  // withdraw / limit need the jetton and its decimals
  if (!chat.jetton_master) return Response.json({ error: "this chat has no jetton" }, { status: 400 });
  let metadata;
  try {
    metadata = await fetchJettonMetadata(chat.jetton_master);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (metadata.decimals === null) {
    return Response.json({ error: "cannot read this jetton's decimals right now, try again later" }, { status: 502 });
  }
  let amount;
  try {
    amount = parseUnits(String(body?.amount ?? ""), metadata.decimals);
  } catch {
    return Response.json({ error: `invalid amount: ${body?.amount}` }, { status: 400 });
  }

  if (action === "limit") {
    // 0 restores the default budget (10% of the balance per day)
    return tx(buildSetClaimLimitBody({ jettonMaster: chat.jetton_master, dailyLimit: amount }));
  }

  if (amount <= 0n) return Response.json({ error: "amount must be positive" }, { status: 400 });
  let to;
  try {
    to = Address.parse(String(body?.to || ""));
  } catch {
    return Response.json({ error: "a valid destination wallet is required" }, { status: 400 });
  }
  return tx(buildWithdrawRemainderBody({ jettonMaster: chat.jetton_master, amount, to }), GAS.withdrawTon);
}
