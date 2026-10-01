// A chat's achievement rating: who holds the most medals in it. The pure
// parts live here (the aggregation stage list, the order, the shape a member
// sees); api/chats/[chatId]/rating runs the queries.
//
// Order: more achievements first; then more points earned in the chat
// (rewards.points); then whoever reached their count first (the date their
// latest distinct achievement was unlocked); the user id last, only so the
// order is stable. Members who hold no achievement in the chat are not rated.
//
// What leaves the server is what the chat's members already see in Telegram:
// a first name or @username and the medals the bot announced in the chat.
// No user ids (the requester's own row is flagged instead) and no points
// (balances are shown to their owner and the chat creator only).

const DEFAULT_LIMIT = 50;
const MAX_MEDALS = 30; // per row; the bot has about twenty types

// One document per achiever of `chatId`: { _id: user_id, achievements,
// reached_at } where reached_at is epoch ms (null when no date is stored).
// The bot awards a type once per (chat, user, collection), so distinct types
// are counted: a duplicate left by a race is not an extra medal. Dates are
// epoch ms numbers (giveAchievement), older data may hold Dates: both
// convert to a long. Only the $match needs an index (chat_id first, e.g.
// the bot's { chat_id: 1, user_id: 1, type: 1 }); the rest runs on that
// chat's documents.
function achieversPipeline(chatId) {
    return [
        { $match: { chat_id: chatId } },
        {
            $group: {
                _id: { user_id: '$user_id', type: '$type', collection: { $ifNull: ['$collection', 'v1'] } },
                at: { $min: { $convert: { input: '$date', to: 'long', onError: null, onNull: null } } },
            },
        },
        { $group: { _id: '$_id.user_id', achievements: { $sum: 1 }, reached_at: { $max: '$at' } } },
    ];
}

function compareMembers(a, b) {
    if (a.achievements !== b.achievements) return b.achievements - a.achievements;
    if (a.points !== b.points) return b.points - a.points;
    const aAt = a.reached_at ?? Infinity;
    const bAt = b.reached_at ?? Infinity;
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
}

// Ranks the achievers (rows of achieversPipeline) with their points
// (Map user_id -> points). Returns the first `limit` as `top`, and `me`, the
// requester's entry when they are rated but outside the top (null when they
// are in it or not rated). Ranks are 1-based positions: ties are broken, so
// every member has their own place.
function rankMembers(rows, pointsByUser, { userId, limit = DEFAULT_LIMIT } = {}) {
    const ranked = rows
        .filter((row) => row && row._id !== null && row._id !== undefined && row.achievements > 0)
        .map((row) => ({
            user_id: row._id,
            achievements: row.achievements,
            points: Number(pointsByUser.get(row._id)) || 0,
            reached_at: Number.isFinite(row.reached_at) ? row.reached_at : null,
        }))
        .sort(compareMembers)
        .map((member, index) => ({ ...member, rank: index + 1 }));
    const top = ranked.slice(0, limit);
    const mine = ranked.find((member) => member.user_id === userId) || null;
    return { total: ranked.length, top, me: mine && mine.rank > limit ? mine : null };
}

// The name members see: the first name, else @username, else null (the page
// then says "Member"). From the bot's users collection, or a Telegram user.
function publicName(user) {
    if (!user) return null;
    const first = String(user.first_name || '').trim();
    if (first) return first;
    const username = String(user.username || '').trim();
    return username ? `@${username}` : null;
}

// Medals of the rated members, oldest first: Map user_id -> [{ type,
// collection }] from their achievement documents in the chat.
function medalsByUser(docs) {
    const byUser = new Map();
    const seen = new Set();
    const sorted = [...docs].sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));
    for (const doc of sorted) {
        const collection = doc.collection || 'v1';
        const key = `${doc.user_id}|${collection}|${doc.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = byUser.get(doc.user_id) || [];
        if (list.length < MAX_MEDALS) list.push({ type: doc.type, collection });
        byUser.set(doc.user_id, list);
    }
    return byUser;
}

// A ranked member as the page gets it.
function publicEntry(member, { names, medals, userId }) {
    return {
        rank: member.rank,
        name: names.get(member.user_id) ?? null,
        achievements: member.achievements,
        medals: medals.get(member.user_id) || [],
        me: member.user_id === userId,
    };
}

// Telegram statuses of someone who is in the chat.
const IN_CHAT = new Set(['creator', 'administrator', 'member', 'restricted']);

// Whether the requester may see the chat's rating. Telegram's word wins when
// it has one (a live member of the chat, or someone who left or was banned);
// when the bot cannot ask (no token, lost access), the database decides the
// way the dashboard lists chats: a rewards record or an achievement there.
function canSeeRating({ status, hasRecord }) {
    if (IN_CHAT.has(status)) return true;
    if (status === 'left' || status === 'kicked') return false;
    return Boolean(hasRecord);
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_MEDALS,
    achieversPipeline,
    compareMembers,
    rankMembers,
    publicName,
    medalsByUser,
    publicEntry,
    canSeeRating,
};
