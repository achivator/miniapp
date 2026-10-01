// "v1/programmer" -> templateId in the AchievementRegistry, printed by
// ton-contracts/scripts/registerTemplates.ts.
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

// Template id for an off-chain achievement, or null when it has no NFT.
function templateIdFor(collection, type) {
    const id = getTonConfig().achievementTemplates[`${collection || 'v1'}/${String(type || '').toLowerCase()}`];
    return Number.isInteger(id) ? id : null;
}

module.exports = { getTonConfig, templateIdFor };
