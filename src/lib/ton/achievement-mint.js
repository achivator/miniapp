// Which achievement registry protocol a mint goes through. Registries are
// immutable: a v2 registry (transferable NFTs, template ids, raw Telegram
// ids in the voucher) keeps its layouts for good, a v3 registry mints
// soulbound items keyed by template key and HMAC user tag
// (lib/ton/achievement-tags.js). ACHIEVEMENT_TEMPLATES says which: integer
// ids for v2, hex keys for v3.
const rpc = require('./rpc');
const { hasTagKey, userTag } = require('./achievement-tags');

// The protocol to mint `template` ({ id } or { key }, config.templateFor)
// on a registry of `version`, or null when they do not fit together (or the
// v3 tag key is missing).
function mintProtocol(version, template) {
    if (!template) return null;
    if (version === 2 && template.id !== undefined) return 2;
    if (version === 3 && template.key !== undefined && hasTagKey()) return 3;
    return null;
}

// Whether the Telegram user already holds the achievement's NFT: the v2
// registry's isMinted getter, or for v3 whether the SBT at the address of
// (template key, user tag) exists.
async function isAchievementMinted(registryAddress, protocol, template, tgUserId) {
    if (protocol === 2) return rpc.fetchIsMinted(registryAddress, template.id, tgUserId);
    return rpc.fetchAchievementMinted(registryAddress, template.key, userTag(tgUserId));
}

module.exports = { mintProtocol, isAchievementMinted };
