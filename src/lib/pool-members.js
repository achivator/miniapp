const { Address } = require('@ton/core');
const { getCollection } = require('./mongo');
const { getChatMember, getChatMemberStatus } = require('./telegram');
const { authenticate } = require('./auth');
const { dateMatch } = require('./lot-dates');

// Read-only views of a chat's reward ledger for its creator (the pool admin
// in the mini app): who earned what, what was paid out, what is still owed.
//
// Ledger reminder (rewards collection, one doc per chat member):
//   points          everything earned (reactions + /reward grants, net of
//                   reactions taken back);
//   claimed_points  points reserved by claim vouchers, confirmed or not.
// A claim doc is the payout record: `issued` until the chain confirms it
// (`claimed`) or its voucher lapses unused (`expired`, points released).

const DAY = 86400;

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// Only the chat creator sees other members' balances and payout wallets.
// Read-only, so the stored creator flag is enough - unless Telegram actively
// says the caller is no longer the creator (ownership moved on).
async function requireChatCreator(request, chatId) {
    const auth = authenticate(request);
    if (!Number.isSafeInteger(chatId)) throw httpError(400, 'chatId is required');
    const chat = await (await getCollection('chats')).findOne({ id: chatId });
    if (!chat) throw httpError(404, 'chat not found');
    if (chat.creator !== auth.user.id) throw httpError(403, 'only the chat creator can see member accounts');
    const live = await getChatMemberStatus(chatId, auth.user.id);
    if (live !== null && live !== 'creator') {
        throw httpError(403, 'Telegram does not confirm you as the chat creator');
    }
    return { auth, chat };
}

function errorResponse(e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
}

function sameAddress(a, b) {
    if (!a || !b) return false;
    try {
        return Address.parse(String(a)).equals(Address.parse(String(b)));
    } catch {
        return false;
    }
}

// How a claim looks to the admin. `issued` past its expiry is unknown until
// the chain is asked (the member's next visit reconciles it): the voucher may
// have been used at the last second, so it is neither paid nor released yet.
function claimState(claim, nowSec) {
    if (claim.status === 'claimed') return 'paid';
    if (claim.status === 'expired') return 'expired';
    return claim.expiry > nowSec ? 'pending' : 'unconfirmed';
}

// Totals of a member's (or a whole chat's) claims. Jetton units are summed
// only for claims in `jettonMaster`: a chat that switched jettons has older
// payouts in another token, and adding those units up would be meaningless.
function summarizeClaims(claims, jettonMaster, nowSec) {
    const sum = () => ({ count: 0, points: 0, units: 0n });
    const out = { paid: sum(), pending: sum(), unconfirmed: sum(), expired: sum(), other_jetton: false };
    for (const claim of claims) {
        const bucket = out[claimState(claim, nowSec)];
        bucket.count += 1;
        bucket.points += claim.points || 0;
        if (sameAddress(claim.jetton_master, jettonMaster)) bucket.units += BigInt(claim.amount || 0);
        else if (claim.status !== 'expired') out.other_jetton = true;
    }
    return out;
}

function serializeSummary(summary) {
    const bucket = (b) => ({ count: b.count, points: b.points, units: b.units.toString() });
    return {
        paid: bucket(summary.paid),
        pending: bucket(summary.pending),
        unconfirmed: bucket(summary.unconfirmed),
        expired: bucket(summary.expired),
        other_jetton: summary.other_jetton,
    };
}

function displayName(user) {
    if (!user) return null;
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return full || (user.username ? `@${user.username}` : null);
}

// Names come from Telegram (the database stores ids only). Members the bot
// cannot see - left, never joined, bot lost admin rights - stay nameless.
async function memberProfiles(chatId, userIds) {
    const entries = await Promise.all(
        [...new Set(userIds)].map(async (id) => {
            const member = await getChatMember(chatId, id);
            return [
                id,
                {
                    name: displayName(member?.user),
                    username: member?.user?.username || null,
                    status: member?.status || null,
                    is_bot: Boolean(member?.user?.is_bot),
                },
            ];
        }),
    );
    return new Map(entries);
}

// Still-maturing points of several members at once (same rules as
// claim-rules.maturingPoints, batched for a page of the member list).
async function maturingByUser(chatId, userIds, maturationDays, nowSec) {
    const result = new Map();
    if (!maturationDays || userIds.length === 0) return result;
    const cutoffSec = nowSec - maturationDays * DAY;
    const [reactions, grants] = await Promise.all([
        (await getCollection('reaction_points'))
            .aggregate([
                { $match: { chat_id: chatId, receiver_id: { $in: userIds }, ...dateMatch({ gt: cutoffSec * 1000 }) } },
                { $group: { _id: '$receiver_id', points: { $sum: '$points' } } },
            ])
            .toArray(),
        (await getCollection('grants'))
            .aggregate([
                { $match: { chat_id: chatId, user_id: { $in: userIds }, ...dateMatch({ gt: cutoffSec * 1000 }) } },
                { $group: { _id: '$user_id', points: { $sum: '$points' } } },
            ])
            .toArray(),
    ]);
    for (const row of [...reactions, ...grants]) result.set(row._id, (result.get(row._id) || 0) + row.points);
    return result;
}

module.exports = {
    requireChatCreator,
    errorResponse,
    httpError,
    sameAddress,
    claimState,
    summarizeClaims,
    serializeSummary,
    displayName,
    memberProfiles,
    maturingByUser,
};
