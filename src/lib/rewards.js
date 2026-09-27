const { getCollection } = require('./mongo');
const { getTonConfig } = require('./ton/config');
const { runGetMethod, fetchPoolAddress, stackItemToBigInt } = require('./ton/rpc');

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

async function isNonceUsedOnChain(poolAddress, nonce) {
    const stack = await runGetMethod(poolAddress, 'isNonceUsed', [['num', '0x' + BigInt(nonce).toString(16)]]);
    return stackItemToBigInt(stack[0]) === 1n;
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
            const poolAddress = await fetchPoolAddress(getTonConfig().masterAddress, chatId);
            used = await isNonceUsedOnChain(poolAddress, claim.nonce);
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
async function claimPoints(chatId, userId, points, ceiling = Infinity) {
    const rewards = await getCollection('rewards');
    const next = { $add: [{ $ifNull: ['$claimed_points', 0] }, points] };
    const conditions = [{ $lte: [next, '$points'] }];
    if (Number.isFinite(ceiling)) conditions.push({ $lte: [next, ceiling] });
    const res = await rewards.updateOne(
        { chat_id: chatId, user_id: userId, $expr: { $and: conditions } },
        { $inc: { claimed_points: points } },
    );
    return res.modifiedCount === 1;
}

module.exports = { reconcileExpiredClaims, claimPoints, isNonceUsedOnChain, nowSeconds };
