const { GLOBAL_ID } = require('./constants');

// "v1/programmer" -> the achievement's template in the AchievementRegistry,
// printed by ton-contracts/scripts/registerTemplates.ts: a template id
// (integer) for a v2 registry, a template key ("0x" + 64 hex digits) for a
// v3 one.
function parseTemplates(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function getTonConfig() {
    const network = process.env.NEXT_PUBLIC_TON_NETWORK || 'testnet';
    const base =
        process.env.TONCENTER_URL ||
        (network === 'mainnet' ? 'https://toncenter.com' : 'https://testnet.toncenter.com');
    return {
        network,
        // the network's global id (config param 19), which every voucher is
        // signed for; null for an unknown network (signing then fails)
        globalId: Object.hasOwn(GLOBAL_ID, network) ? GLOBAL_ID[network] : null,
        toncenterBase: base.replace(/\/+$/, ''),
        toncenterApiKey: process.env.TONCENTER_API_KEY || '',
        masterAddress: process.env.NEXT_PUBLIC_MASTER_ADDRESS || process.env.MASTER_ADDRESS || '',
        // Masters replaced by a redeploy: their pools may still have paid out
        // claims the database has not settled yet (lib/rewards.js).
        legacyMasterAddresses: String(process.env.LEGACY_MASTER_ADDRESSES || '')
            .split(',')
            .map((address) => address.trim())
            .filter(Boolean),
        jettonsPerPoint: process.env.JETTONS_PER_POINT || '0.01',
        registryAddress: process.env.ACHIEVEMENT_REGISTRY || '',
        achievementTemplates: parseTemplates(process.env.ACHIEVEMENT_TEMPLATES),
    };
}

// The registry template of an off-chain achievement: { id } (v2 registry),
// { key } (v3 registry, a BigInt), or null when it has no NFT.
function templateFor(collection, type) {
    const value = getTonConfig().achievementTemplates[`${collection || 'v1'}/${String(type || '').toLowerCase()}`];
    if (Number.isInteger(value) && value >= 0 && value < 2 ** 32) return { id: value };
    if (typeof value === 'string' && /^0x[0-9a-f]{1,64}$/i.test(value)) return { key: BigInt(value) };
    return null;
}

module.exports = { getTonConfig, templateFor };
