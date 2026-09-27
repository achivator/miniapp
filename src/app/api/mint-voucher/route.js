import { Address } from "@ton/core";
import { ObjectId } from "mongodb";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig, templateIdFor } from "@/lib/ton/config";
import { fetchIsMinted } from "@/lib/ton/rpc";
import { buildMintBody, buildMintVoucherCell, defaultExpiry, signVoucher } from "@/lib/ton/vouchers";
import { GAS, SECONDS, VOUCHER_TAG } from "@/lib/ton/constants";
import { nowSeconds } from "@/lib/rewards";

export const dynamic = "force-dynamic";

// Signs a MintVoucher for one of the caller's own achievements. The registry
// enforces one NFT per (template, Telegram user), so re-issuing a voucher is
// harmless; the voucher binds the Telegram user id, the recipient wallet is
// the caller's choice.
export async function POST(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = await request.json().catch(() => null);
  const id = String(body?.achievementId || "");
  let recipient;
  try {
    recipient = Address.parse(String(body?.wallet || ""));
  } catch {
    return Response.json({ error: "a valid wallet is required" }, { status: 400 });
  }
  if (!ObjectId.isValid(id)) return Response.json({ error: "invalid achievement id" }, { status: 400 });

  const cfg = getTonConfig();
  if (!cfg.registryAddress || !process.env.BACKEND_SECRET) {
    return Response.json({ error: "NFT minting is not configured" }, { status: 503 });
  }

  const achievement = await (await getCollection("achievements")).findOne({
    _id: new ObjectId(id),
    user_id: auth.user.id,
  });
  if (!achievement) return Response.json({ error: "achievement not found" }, { status: 404 });

  const templateId = templateIdFor(achievement.collection, achievement.type);
  if (templateId === null) {
    return Response.json({ error: "this achievement cannot be minted yet" }, { status: 400 });
  }

  try {
    if (await fetchIsMinted(cfg.registryAddress, templateId, auth.user.id)) {
      return Response.json({ error: "you already own this NFT" }, { status: 409 });
    }
  } catch {
    // RPC hiccup: the registry still refuses a second mint
  }

  const counter = await (await getCollection("counters")).findOneAndUpdate(
    { _id: "mint_nonce" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const nonce = counter.seq;
  const expiry = defaultExpiry(SECONDS.mintVoucherTtl);
  const voucher = buildMintVoucherCell({ templateId, recipient, tgUserId: auth.user.id, nonce, expiry });
  const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
    tag: VOUCHER_TAG.Mint,
    target: cfg.registryAddress,
  });

  await (await getCollection("mints")).insertOne({
    achievement_id: achievement._id,
    user_id: auth.user.id,
    template_id: templateId,
    nonce,
    recipient: recipient.toString(),
    expiry: Number(expiry),
    created_at: nowSeconds(),
  });

  return Response.json({
    ok: true,
    to: Address.parse(cfg.registryAddress).toString(),
    amount: GAS.mintTon,
    payload_b64: buildMintBody({ voucherCell: voucher, signature }).toBoc().toString("base64"),
    template_id: templateId,
    expiry: Number(expiry),
  });
}
