import { Address } from "@ton/core";
import { ObjectId } from "mongodb";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig, templateFor } from "@/lib/ton/config";
import { fetchContractVersion, fetchTemplateRegistered } from "@/lib/ton/rpc";
import { isAchievementMinted, mintProtocol } from "@/lib/ton/achievement-mint";
import { hasTagKey, toHex256, userTag } from "@/lib/ton/achievement-tags";
import { buildMintBody, buildMintVoucherCell, buildMintVoucherV3Cell, defaultExpiry, signVoucher } from "@/lib/ton/vouchers";
import { GAS, SECONDS, SIGNABLE_VERSIONS, VOUCHER_TAG } from "@/lib/ton/constants";
import { nowSeconds } from "@/lib/rewards";

export const dynamic = "force-dynamic";

// Signs a MintVoucher for one of the caller's own achievements, in the
// layout of the registry's protocol version:
// - v3: soulbound items. The voucher binds the template key, the caller's
//   wallet (which must send the mint itself) and the HMAC tag of the
//   Telegram user, never the id. One SBT per (template, user) lives at an
//   address derived from both, so re-issuing a voucher is harmless: a second
//   mint finds the address taken and is refunded.
// - v2 (legacy registry): template id, Telegram id and a nonce.
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

  const template = templateFor(achievement.collection, achievement.type);
  if (!template) {
    return Response.json({ error: "this achievement cannot be minted yet" }, { status: 400 });
  }

  // The voucher is signed in the envelope and layout of the registry's
  // protocol version.
  let registryVersion;
  try {
    registryVersion = await fetchContractVersion(cfg.registryAddress);
  } catch (e) {
    return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
  }
  if (!SIGNABLE_VERSIONS.includes(registryVersion)) {
    console.error(`mint refused: registry v${registryVersion} but backend signs v${SIGNABLE_VERSIONS.join("/")}`);
    return Response.json({ error: "NFT minting is not available right now" }, { status: 503 });
  }
  if (registryVersion === 3 && !hasTagKey()) {
    console.error("mint refused: ACHIEVEMENT_TAG_KEY is not set");
    return Response.json({ error: "NFT minting is not configured" }, { status: 503 });
  }
  const protocol = mintProtocol(registryVersion, template);
  if (protocol === null) {
    console.error(`mint refused: ACHIEVEMENT_TEMPLATES does not fit the v${registryVersion} registry`);
    return Response.json({ error: "NFT minting is not available right now" }, { status: 503 });
  }

  if (protocol === 3) {
    // A mint for a template that is not registered would bounce and its
    // TON would stay on the registry: check before signing.
    let registered;
    try {
      registered = await fetchTemplateRegistered(cfg.registryAddress, template.key);
    } catch (e) {
      return Response.json({ error: `TON RPC failed: ${e.message}` }, { status: 502 });
    }
    if (!registered) {
      console.error(`mint refused: template ${toHex256(template.key)} is not registered on the registry`);
      return Response.json({ error: "NFT minting is not available right now" }, { status: 503 });
    }
  }

  try {
    if (await isAchievementMinted(cfg.registryAddress, protocol, template, auth.user.id)) {
      return Response.json({ error: "you already own this NFT" }, { status: 409 });
    }
  } catch {
    // RPC hiccup: the registry still refuses a second mint (and refunds it)
  }

  const expiry = defaultExpiry(SECONDS.mintVoucherTtl);
  const mints = await getCollection("mints");
  let voucher;
  let record; // what the mints log and the reply name the template by
  if (protocol === 3) {
    voucher = buildMintVoucherV3Cell({ templateKey: template.key, recipient, userTag: userTag(auth.user.id), expiry });
    record = { template_key: toHex256(template.key) };
  } else {
    const counter = await (await getCollection("counters")).findOneAndUpdate(
      { _id: "mint_nonce" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    const nonce = counter.seq;
    voucher = buildMintVoucherCell({ templateId: template.id, recipient, tgUserId: auth.user.id, nonce, expiry });
    record = { template_id: template.id };
    record.nonce = nonce;
  }
  const signature = signVoucher(voucher, process.env.BACKEND_SECRET, {
    tag: VOUCHER_TAG.Mint,
    target: cfg.registryAddress,
    version: registryVersion,
    globalId: cfg.globalId,
  });

  await mints.insertOne({
    achievement_id: achievement._id,
    user_id: auth.user.id,
    ...record,
    recipient: recipient.toString(),
    expiry: Number(expiry),
    created_at: nowSeconds(),
  });

  return Response.json({
    ok: true,
    to: Address.parse(cfg.registryAddress).toString(),
    amount: GAS.mintTon,
    payload_b64: buildMintBody({ voucherCell: voucher, signature }).toBoc().toString("base64"),
    ...(protocol === 3 ? { template_key: record.template_key } : { template_id: template.id }),
    expiry: Number(expiry),
  });
}
