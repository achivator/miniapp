import { ObjectId } from "mongodb";
import { authenticate } from "@/lib/auth";
import { getCollection } from "@/lib/mongo";
import { getTonConfig, templateFor } from "@/lib/ton/config";
import { fetchContractVersion } from "@/lib/ton/rpc";
import { isAchievementMinted, mintProtocol } from "@/lib/ton/achievement-mint";
import { GAS } from "@/lib/ton/constants";

export const dynamic = "force-dynamic";

// One of the caller's own achievements. Owner check: the lookup is scoped to
// the authenticated user, so another user's id yields 404.
export async function GET(request) {
  let auth;
  try {
    auth = authenticate(request);
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 });
  }

  const id = new URL(request.url).searchParams.get("_id");
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ error: "invalid achievement id" }, { status: 400 });
  }

  const achievement = await (await getCollection("achievements")).findOne({
    _id: new ObjectId(id),
    user_id: auth.user.id,
  });
  if (!achievement) return Response.json({ error: "achievement not found" }, { status: 404 });

  const chat = await (await getCollection("chats")).findOne({ id: achievement.chat_id });

  // NFT status: mintable only once the registry and its template exist,
  // and the template fits the registry's protocol (v2 id or v3 key).
  const cfg = getTonConfig();
  const template = cfg.registryAddress ? templateFor(achievement.collection, achievement.type) : null;
  let mintable = template !== null;
  let minted = null;
  if (template) {
    try {
      const protocol = mintProtocol(await fetchContractVersion(cfg.registryAddress), template);
      mintable = protocol !== null;
      if (mintable) minted = await isAchievementMinted(cfg.registryAddress, protocol, template, auth.user.id);
    } catch {
      minted = null;
    }
  }
  return Response.json({
    _id: String(achievement._id),
    type: achievement.type,
    collection: achievement.collection || "v1",
    date: achievement.date,
    chat: { id: achievement.chat_id, title: chat?.title || null },
    nft: {
      mintable,
      minted,
      // the medal is bound to the wallet it is minted to (TEP-85 SBT)
      soulbound: true,
      price_ton: GAS.mintTon,
      network: cfg.network,
    },
  });
}
