const { getCollection } = require('./mongo');
const { affectedWindow, normalizeLots, priceTimeline, valueClaim } = require('./lot-pricing');
const { claimSettingsOf } = require('./claim-rules');

// Reads members' point lots (see lot-pricing.js) from the bot's collections:
//   reaction_points { chat_id, receiver_id, points, date: Date }
//   grants          { chat_id, user_id, points, date: epoch ms (a number) }
//
// Only lots earned while a decrease could reach them are read one by one:
// everything earned at or before (first decrease - maturation) is paid at the
// current price and is the oldest, so it is summed into one lot per member;
// everything earned at or after the last decrease is paid at the current
// price and is the newest, so it is summed into another. Without any
// decrease in the history that is a single sum per member.

const NO_DATE_FILTER = Symbol('none');

// Mongo date conditions for one collection: reactions compare as Dates,
// grants as numbers (a Date would never match a number and vice versa).
function dateRange(asDate, { gt = NO_DATE_FILTER, lt = NO_DATE_FILTER, lte = NO_DATE_FILTER, gte = NO_DATE_FILTER }) {
    const wrap = (ms) => (asDate ? new Date(ms) : ms);
    const cond = {};
    if (gt !== NO_DATE_FILTER) cond.$gt = wrap(gt);
    if (gte !== NO_DATE_FILTER) cond.$gte = wrap(gte);
    if (lt !== NO_DATE_FILTER) cond.$lt = wrap(lt);
    if (lte !== NO_DATE_FILTER) cond.$lte = wrap(lte);
    // an unbounded range still requires a date of the right type, so a lot is
    // counted in exactly one of the ranges below
    if (Object.keys(cond).length === 0) cond.$type = asDate ? 'date' : 'number';
    return cond;
}

// userIds: an array (those members only) or null (every member of the chat).
// Returns Map(userId -> raw lots [{ points, at }]); pass each member's list to
// normalizeLots() with their rewards.points.
async function loadLots(chatId, userIds, timeline, maturationDays) {
    const result = new Map();
    if (Array.isArray(userIds) && userIds.length === 0) return result;
    const add = (userId, lot) => {
        const list = result.get(userId) || [];
        list.push(lot);
        result.set(userId, list);
    };

    const window = affectedWindow(timeline, maturationDays);
    const sources = [
        { col: await getCollection('reaction_points'), user: 'receiver_id', asDate: true },
        { col: await getCollection('grants'), user: 'user_id', asDate: false },
    ];

    const jobs = [];
    for (const { col, user, asDate } of sources) {
        const base = { chat_id: chatId };
        if (Array.isArray(userIds)) base[user] = { $in: userIds };
        const sum = (range, at) =>
            col
                .aggregate([
                    { $match: { ...base, date: dateRange(asDate, range) } },
                    { $group: { _id: `$${user}`, points: { $sum: '$points' } } },
                ])
                .toArray()
                .then((rows) => rows.forEach((row) => add(row._id, { points: row.points, at })));
        if (window === null) {
            jobs.push(sum({}, 0));
            continue;
        }
        jobs.push(sum({ lte: window.from }, window.from));
        // both bounds: with no maturation and one decrease, from === to
        jobs.push(sum({ gt: window.from, gte: window.to }, window.to));
        jobs.push(
            col
                .find(
                    { ...base, date: dateRange(asDate, { gt: window.from, lt: window.to }) },
                    { projection: { _id: 0, [user]: 1, points: 1, date: 1 } },
                )
                .toArray()
                .then((docs) => docs.forEach((doc) => add(doc[user], { points: doc.points, at: doc.date }))),
        );
    }
    await Promise.all(jobs);
    return result;
}

// Everything needed to value members' points in one chat, from one read of
// the chat document: its price timeline and maturation, and the lots of
// `userIds` (null: every member). Throws like pointPriceFor() on a corrupted
// price.
async function chatLots(chat, userIds, now = new Date()) {
    const timeline = priceTimeline(chat, now);
    const maturationDays = claimSettingsOf(chat).maturation_days;
    const raw = await loadLots(chat.id, userIds, timeline, maturationDays);
    const lotsOf = (record) => normalizeLots(raw.get(record?.user_id) || [], record?.points || 0);
    // Values `count` points after the member's claimed ones (FIFO); `skip`
    // starts further in (e.g. past the claimable points, at the maturing ones).
    const value = (record, count, decimals, { skip = 0, payable = null } = {}) =>
        valueClaim({
            lots: lotsOf(record),
            claimed: (record?.claimed_points || 0) + skip,
            count,
            timeline,
            maturationDays,
            decimals,
            payable,
        });
    // Every point the member has not claimed yet, maturing included.
    const owed = (record, decimals) =>
        value(record, Math.max(0, (record?.points || 0) - (record?.claimed_points || 0)), decimals);
    return { timeline, maturationDays, lotsOf, value, owed };
}

// What the chat owes all its members if everyone claimed everything they hold
// (maturing points included: they will be claimed later, at the price the
// valuation gives them), in jetton units. `ctx`: a chatLots(chat, null) the
// caller already has.
async function chatDebt(chat, decimals, now = new Date(), ctx = null) {
    const records = await (await getCollection('rewards'))
        .find(
            { chat_id: chat.id, $expr: { $gt: [{ $ifNull: ['$points', 0] }, { $ifNull: ['$claimed_points', 0] }] } },
            { projection: { _id: 0, user_id: 1, points: 1, claimed_points: 1 } },
        )
        .toArray();
    let units = 0n;
    let points = 0;
    if (records.length === 0) return { units, points, members: 0 };
    const lots = ctx || (await chatLots(chat, null, now));
    for (const record of records) {
        const owed = lots.owed(record, decimals);
        units += owed.units;
        points += owed.points;
    }
    return { units, points, members: records.length };
}

module.exports = { loadLots, chatLots, chatDebt, _dateRange: dateRange };
