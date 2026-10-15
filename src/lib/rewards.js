const { getCollection } = require('./mongo');
const { getTonConfig } = require('./ton/config');
const rpc = require('./ton/rpc');
const { SECONDS } = require('./ton/constants');

const { TonRpcError, runGetMethod, fetchPoolAddress, getAddressInformation, stackItemToBigInt } = rpc;

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

async function isNonceUsedOnChain(poolAddress, nonce) {
    const stack = await runGetMethod(poolAddress, 'isNonceUsed', [['num', '0x' + BigInt(nonce).toString(16)]]);
    return stackItemToBigInt(stack[0]) !== 0n; // Tact encodes true as -1
}

// The pools a claim can have been paid from. A claim records its pool when it
// is issued; older claims came from the chat's pool under the current master
// or, after a redeploy, under a replaced one (LEGACY_MASTER_ADDRESSES).
// Asking only the current master's pool would read an old payout as never
// sent, release its points and let the member claim them a second time.
async function claimPools(claim) {
    if (claim.pool_address) return [claim.pool_address];
    const { masterAddress, legacyMasterAddresses = [] } = getTonConfig();
    const pools = [];
    for (const master of [masterAddress, ...legacyMasterAddresses].filter(Boolean)) {
        const pool = await fetchPoolAddress(master, claim.chat_id);
        if (pool) pools.push(pool.toString());
    }
    return pools;
}

// What one pool says about a claim nonce: 'paid', 'unpaid' or 'unknown'.
// Protocol v3 pools keep a nonce burnt for good (nonceState): 1 paid; 0
// never used and 2 bounced (the jettons never left) are unpaid; 3 is retired,
// its record pruned a week after the claim, so whether it was paid is no
// longer known on-chain. v2 pools only have isNonceUsed, which a bounce
// turns back to false (unpaid as well: the jettons stayed).
async function poolClaimState(pool, nonce) {
    const version = await rpc.fetchContractVersion(pool);
    if (version >= 3) {
        const state = await rpc.fetchNonceState(pool, nonce);
        if (state === 1) return 'paid';
        if (state === 3) return 'unknown';
        return 'unpaid';
    }
    return (await isNonceUsedOnChain(pool, nonce)) ? 'paid' : 'unpaid';
}

// What the chain says about the claim across every pool it can have been
// paid from: 'paid' when any pool paid it, else 'unknown' when a pool no
// longer knows, else 'unpaid'. A pool that was never deployed has used none,
// but the claim was issued by a deployed one: with none to ask, nothing can
// be settled. Throws then, and when the chain cannot be read: the caller
// keeps the claim issued and retries later.
async function claimChainState(claim) {
    let asked = 0;
    let unknown = false;
    for (const pool of await claimPools(claim)) {
        if ((await getAddressInformation(pool)).state !== 'active') continue;
        asked += 1;
        const state = await poolClaimState(pool, claim.nonce);
        if (state === 'paid') return 'paid';
        if (state === 'unknown') unknown = true;
    }
    if (asked === 0) throw new TonRpcError(`no deployed pool to settle claim ${claim.nonce} against`);
    return unknown ? 'unknown' : 'unpaid';
}

// Whether the claim's nonce was used on any pool it can have been paid from.
async function isClaimPaid(claim) {
    return (await claimChainState(claim)) === 'paid';
}

// Expired vouchers either got confirmed on-chain before expiry (nonce used ->
// mark claimed) or were never sent or bounced (release the deducted points;
// a v3 pool never accepts the nonce again, so the member claims anew under a
// new one). The chain is the source of truth, so a released voucher can never
// be double-claimed: a voucher is only settled claimReconcileMargin after its
// expiry, when a claim sent just before it can no longer be in flight (CP-10).
// A nonce a v3 pool has retired (pruned a week after a claim; the backend
// normally settles long before) cannot be told apart: its points stay
// deducted and the claim is marked 'unknown' for a manual look.
async function reconcileExpiredClaims(chatId, userId) {
    const claims = await getCollection('claims');
    const rewards = await getCollection('rewards');
    const now = nowSeconds();
    const expired = await claims
        .find({
            chat_id: chatId,
            user_id: userId,
            status: 'issued',
            expiry: { $lt: now - SECONDS.claimReconcileMargin },
        })
        .toArray();

    for (const claim of expired) {
        let state;
        try {
            state = await claimChainState(claim);
        } catch {
            continue; // chain unreadable: keep the claim issued, retry later
        }
        if (state === 'paid') {
            await claims.updateOne({ _id: claim._id, status: 'issued' }, { $set: { status: 'claimed', resolved_at: now } });
        } else if (state === 'unknown') {
            console.error(`claim ${claim.chat_id}/${claim.nonce}: nonce retired on-chain before settling; points kept`);
            await claims.updateOne({ _id: claim._id, status: 'issued' }, { $set: { status: 'unknown', resolved_at: now } });
        } else {
            // The status flip is the lock: exactly one concurrent reconcile
            // may credit the released points back.
            const released = await claims.updateOne(
                { _id: claim._id, status: 'issued' },
                { $set: { status: 'expired', resolved_at: now } },
            );
            if (released.modifiedCount === 1) {
                await rewards.updateOne(
                    { chat_id: chatId, user_id: userId },
                    { $inc: { claimed_points: -claim.points } },
                );
            }
        }
    }
}

// Check-and-deduct in one atomic update: the match condition is evaluated
// against the document at write time, so concurrent claims (any number of
// backend instances) can never push claimed_points above points - nor above
// `ceiling` (points minus what was still maturing when the claim was sized),
// so points that arrive mid-request can never be claimed before they mature.
// With `expectedClaimed`, claimed_points must also still be exactly that
// value: claims take the oldest points first and are valued by which points
// they take (lib/lot-pricing.js), so a claim sized from one claimed_points
// must not be booked onto another.
async function claimPoints(chatId, userId, points, ceiling = Infinity, expectedClaimed = null) {
    const rewards = await getCollection('rewards');
    const current = { $ifNull: ['$claimed_points', 0] };
    const next = { $add: [current, points] };
    const conditions = [{ $lte: [next, '$points'] }];
    if (Number.isFinite(ceiling)) conditions.push({ $lte: [next, ceiling] });
    if (expectedClaimed !== null) conditions.push({ $eq: [current, expectedClaimed] });
    const res = await rewards.updateOne(
        { chat_id: chatId, user_id: userId, $expr: { $and: conditions } },
        { $inc: { claimed_points: points } },
    );
    return res.modifiedCount === 1;
}

module.exports = {
    reconcileExpiredClaims,
    claimPoints,
    isNonceUsedOnChain,
    isClaimPaid,
    claimChainState,
    claimPools,
    nowSeconds,
};
