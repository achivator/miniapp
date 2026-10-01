const { getCollection } = require('./mongo');
const { getTonConfig } = require('./ton/config');
const { runGetMethod, fetchPoolAddress, getAddressInformation, stackItemToBigInt } = require('./ton/rpc');

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

// Whether the claim's nonce was used on any pool it can have been paid
// from. A pool that was never deployed has used none. Throws when the chain
// cannot be read: the caller keeps the claim issued and retries later.
async function isClaimPaid(claim) {
    for (const pool of await claimPools(claim)) {
        if ((await getAddressInformation(pool)).state !== 'active') continue;
        if (await isNonceUsedOnChain(pool, claim.nonce)) return true;
    }
    return false;
}

// Expired vouchers either got confirmed on-chain before expiry (nonce used ->
// mark claimed) or were never sent (release the deducted points). The chain is
// the source of truth, so a released voucher can never be double-claimed.
async function reconcileExpiredClaims(chatId, userId) {
    const claims = await getCollection('claims');
    const rewards = await getCollection('rewards');
    const now = nowSeconds();
    const expired = await claims
        .find({ chat_id: chatId, user_id: userId, status: 'issued', expiry: { $lt: now } })
        .toArray();

    for (const claim of expired) {
        let used = null;
        try {
            used = await isClaimPaid(claim);
        } catch {
            continue; // chain unreadable: keep the claim issued, retry later
        }
        if (used) {
            await claims.updateOne({ _id: claim._id, status: 'issued' }, { $set: { status: 'claimed', resolved_at: now } });
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

module.exports = { reconcileExpiredClaims, claimPoints, isNonceUsedOnChain, isClaimPaid, claimPools, nowSeconds };
