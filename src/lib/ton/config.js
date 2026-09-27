// Fee tiers are advisory: the contract stores whatever tier/feeTon the
// backend signs (no on-chain cap).
const DEFAULT_FEE_TIERS = [
    { minMembers: 0, tier: 0, feeTon: '0.1' },
    { minMembers: 1000, tier: 1, feeTon: '0.5' },
    { minMembers: 10000, tier: 2, feeTon: '1' },
];

function parseFeeTiers(raw) {
    if (!raw) return DEFAULT_FEE_TIERS;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_FEE_TIERS;
        return parsed
            .map((t) => ({ minMembers: Number(t.minMembers), tier: Number(t.tier), feeTon: String(t.feeTon) }))
            .sort((a, b) => a.minMembers - b.minMembers);
    } catch {
        return DEFAULT_FEE_TIERS;
    }
}

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
        feeTiers: parseFeeTiers(process.env.FEE_TIERS),
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

function tierForMembers(memberCount) {
    const tiers = getTonConfig().feeTiers;
    let picked = tiers[0];
    for (const t of tiers) {
        if (memberCount >= t.minMembers) picked = t;
    }
    return picked;
}

module.exports = { getTonConfig, tierForMembers, templateIdFor, parseFeeTiers, DEFAULT_FEE_TIERS };
