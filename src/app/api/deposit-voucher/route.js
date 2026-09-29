import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig } from "@/lib/ton/config";
import { fetchJettonMetadata, fetchJettonWalletAddress, getPoolStatus } from "@/lib/ton/rpc";
import { buildDepositVoucherCell, buildDepositForwardPayload, buildJettonTransferBody, signVoucher, defaultExpiry } from "@/lib/ton/vouchers";
import { parseUnits } from "@/lib/ton/amounts";
import { GAS, VOUCHER_TAG } from "@/lib/ton/constants";
import { runGetMethod, stackItemToAddress, stackItemToBigInt } from "@/lib/ton/rpc";
import { Address } from "@ton/core";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const chatId = Number(body?.chatId);
  const wallet = body?.wallet;
  const amountStr = body?.amount;
  if (!Number.isSafeInteger(chatId) || !wallet || !amountStr) {
    return Response.json({ error: "chatId, wallet and amount are required" }, { status: 400 });
  }

  let walletAddress;
  try {
    walletAddress = Address.parse(wallet);
  } catch {
    return Response.json({ error: "invalid wallet address" }, { status: 400 });
  }

  const cfg = getTonConfig();
  if (!cfg.masterAddress) {
    return Response.json({ error: "MASTER_ADDRESS is not configured" }, { status: 500 });
  }
  if (!process.env.BACKEND_SECRET) {
    return Response.json({ error: "BACKEND_SECRET is not configured" }, { status: 500 });
  }

  const chatsCol = await getCollection("chats");
  const chat = await chatsCol.findOne({ id: chatId });
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (chat.creator !== auth.user.id) {
    return Response.json({ error: "only the chat creator can deposit" }, { status: 403 });
  }
  if (!chat.jetton_master) {
    return Response.json({ error: "this chat has no jetton configured yet" }, { status: 400 });
  }

  const jettonMaster = chat.jetton_master;
  let metadata;
  let pool;
  try {
    metadata = await fetchJettonMetadata(jettonMaster);
    pool = await getPoolStatus(cfg.masterAddress, chatId);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!pool.poolAddress || !pool.active) {
    return Response.json({ error: "pool is not activated yet; activate it first" }, { status: 409 });
  }

  if (metadata.decimals === null) {
    return Response.json({ error: "cannot read this jetton's decimals right now, try again later" }, { status: 502 });
  }
  // The pool refunds deposits until it has an admin (so a leaked backend key
  // can never seize a funded pool); do not let the creator pay for a refund.
  try {
    const admin = stackItemToAddress((await runGetMethod(pool.poolAddress, "poolAdmin", []))[0]);
    if (!admin) {
      return Response.json({ error: "register the pool admin wallet first" }, { status: 409 });
    }
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }

  let amount;
  try {
    amount = parseUnits(amountStr, metadata.decimals);
  } catch {
    return Response.json({ error: `invalid amount: ${amountStr}` }, { status: 400 });
  }
  if (amount <= 0n) return Response.json({ error: "amount must be positive" }, { status: 400 });

  try {
    const poolJettonWallet = await fetchJettonWalletAddress(jettonMaster, pool.poolAddress);
    const userJettonWallet = await fetchJettonWalletAddress(jettonMaster, walletAddress);

    // best-effort balance check, the wallet may not be deployed yet
    try {
      const stack = await runGetMethod(userJettonWallet, "get_wallet_data", []);
      const balance = stackItemToBigInt(stack[0]);
      if (balance < amount) {
        return Response.json(
          { error: "insufficient jetton balance", balance: balance.toString() },
          { status: 400 },
        );
      }
    } catch {
      // uninitialized wallet: let the chain decide
    }

    const expiry = defaultExpiry();
    const voucher = buildDepositVoucherCell({
      chatId,
      jettonMaster,
      expectedJettonWallet: poolJettonWallet,
      expiry,
    });
    const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
      tag: VOUCHER_TAG.Deposit,
      target: pool.poolAddress,
    });
    const forwardPayload = buildDepositForwardPayload(voucher, signature);
    // Gas only, no fee: the jetton wallet and the pool send back what they
    // do not spend.
    const forwardTonAmount = BigInt(GAS.depositForward);
    const totalTon = forwardTonAmount + BigInt(GAS.depositTransferGas);

    const transferBody = buildJettonTransferBody({
      amount,
      destination: pool.poolAddress,
      responseDestination: walletAddress,
      forwardTonAmount,
      forwardPayload: forwardPayload.asSlice(),
    });

    return Response.json({
      ok: true,
      to: userJettonWallet.toString(),
      amount: totalTon.toString(),
      payload_b64: transferBody.toBoc().toString("base64"),
      pool_address: pool.poolAddress.toString(),
      pool_jetton_wallet: poolJettonWallet.toString(),
      user_jetton_wallet: userJettonWallet.toString(),
      decimals: metadata.decimals,
      expiry: Number(expiry),
    });
  } catch (e) {
    return Response.json({ error: `deposit build failed: ${e.message}` }, { status: 502 });
  }
}
