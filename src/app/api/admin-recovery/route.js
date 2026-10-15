import { Address } from "@ton/core";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchAdminProposal, fetchContractVersion, fetchPoolAdmin, getPoolStatus } from "@/lib/ton/rpc";
import {
  buildAdminProposalVoucherCell,
  buildExecuteAdminProposalBody,
  buildProposeAdminBody,
  defaultExpiry,
  signVoucher,
} from "@/lib/ton/vouchers";
import { GAS, SECONDS, VOUCHER_TAG } from "@/lib/ton/constants";
import { getChatMemberStatus } from "@/lib/telegram";
import { resolveEconomyChatId, telegramChatId } from "@/lib/chat-ids";
import { nowSeconds } from "@/lib/rewards";

export const dynamic = "force-dynamic";

// Admin recovery for a protocol v3 pool whose admin wallet is lost or is no
// longer the chat's (CP-12). A current chat administrator or the creator, as
// Telegram confirms right now, gets a backend-signed AdminProposalVoucher
// naming their connected wallet ({ action: "propose" }). The wallet submits
// it (ProposeAdmin) and a 7-day timelock starts, which the current admin
// wallet can cancel (pool-admin-tx "cancel_proposal"). Once it is over,
// { action: "execute" } hands out the ExecuteAdminProposal transaction (any
// wallet may send it). Rotation by the current admin stays the immediate
// SetAdmin flow.
const RECOVERY_ROLES = ["creator", "administrator"];

export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const requestedChatId = Number(body?.chatId);
  const action = String(body?.action || "propose");
  if (!Number.isSafeInteger(requestedChatId) || !["propose", "execute"].includes(action)) {
    return Response.json({ error: "chatId and a valid action are required" }, { status: 400 });
  }
  let wallet = null;
  if (action === "propose") {
    try {
      wallet = Address.parse(String(body?.wallet || ""));
    } catch {
      return Response.json({ error: "a valid wallet is required" }, { status: 400 });
    }
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress || !process.env.BACKEND_SECRET) {
    return Response.json({ error: "backend is not configured" }, { status: 500 });
  }

  // a supergroup's own id stands for its economy, whose id the pool and
  // every voucher carry (lib/chat-ids.js); Telegram is asked about the chat
  // members actually live in
  const chatId = await resolveEconomyChatId(requestedChatId);
  const chat = await (await getCollection("chats")).findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  const role = await getChatMemberStatus(telegramChatId(chat), auth.user.id);
  if (!RECOVERY_ROLES.includes(role)) {
    return Response.json({ error: "Telegram does not confirm you as an administrator of this chat" }, { status: 403 });
  }

  let pool;
  let version;
  let admin;
  let proposal;
  try {
    pool = await getPoolStatus(cfg.masterAddress, chatId);
    if (!pool.poolAddress || !pool.active) {
      return Response.json({ error: "pool is not activated yet" }, { status: 409 });
    }
    version = await fetchContractVersion(pool.poolAddress);
    if (version < 3) {
      return Response.json(
        { error: "this pool's contract version has no admin recovery", pool_version: version },
        { status: 409 },
      );
    }
    admin = await fetchPoolAdmin(pool.poolAddress);
    proposal = await fetchAdminProposal(pool.poolAddress);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!admin) {
    return Response.json({ error: "the pool has no admin yet: the chat creator sets it up directly" }, { status: 409 });
  }
  const pending = proposal.pendingAdmin
    ? { pending_admin: proposal.pendingAdmin.toString(), executable_at: proposal.executableAt }
    : null;

  if (action === "execute") {
    if (!pending) return Response.json({ error: "no admin recovery is pending" }, { status: 409 });
    if (proposal.executableAt > nowSeconds()) {
      return Response.json({ error: "the 7-day timelock is not over yet", ...pending }, { status: 409 });
    }
    return Response.json({
      ok: true,
      to: pool.poolAddress.toString(),
      amount: GAS.proposeAdminTon,
      payload_b64: buildExecuteAdminProposalBody().toBoc().toString("base64"),
      ...pending,
    });
  }

  if (admin.equals(wallet)) {
    return Response.json({ error: "this wallet already is the pool admin", admin: admin.toString() }, { status: 409 });
  }
  if (pending) {
    return Response.json({ error: "an admin recovery is already pending", ...pending }, { status: 409 });
  }

  const expiry = defaultExpiry(SECONDS.adminProposalVoucherTtl);
  const voucher = buildAdminProposalVoucherCell({ chatId, newAdmin: wallet, seq: proposal.seq, expiry });
  const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
    tag: VOUCHER_TAG.AdminProposal,
    target: pool.poolAddress,
    version,
    globalId: cfg.globalId,
  });

  // who asked, for whom and as what: the pool only shows the wallet
  await (await getCollection("admin_proposals")).insertOne({
    chat_id: chatId,
    user_id: auth.user.id,
    role,
    wallet: wallet.toString(),
    seq: Number(proposal.seq),
    pool_address: pool.poolAddress.toString(),
    previous_admin: admin.toString(),
    expiry: Number(expiry),
    created_at: nowSeconds(),
  });

  return Response.json({
    ok: true,
    to: pool.poolAddress.toString(),
    amount: GAS.proposeAdminTon,
    payload_b64: buildProposeAdminBody({ voucherCell: voucher, signature }).toBoc().toString("base64"),
    expiry: Number(expiry),
    // once the proposal lands, the timelock runs this long
    timelock_seconds: SECONDS.adminRecoveryDelay,
    admin: admin.toString(),
  });
}
