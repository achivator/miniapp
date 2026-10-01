const { getCollection } = require('./mongo');
const {
    ANNOUNCE,
    announcementDoc,
    canonicalDecimal,
    compareDecimal,
    decreaseEffectiveAt,
    envPointPrice,
    pointPriceNoticeDays,
    setPlatformDefault,
} = require('./point-price');
const { writeAnnouncements } = require('./announcements');

// ---- The platform default price of a point (miniapp#12) ----
//
// Chats without their own price pay the platform default. It used to be read
// from JETTONS_PER_POINT on every request, so lowering the env and
// redeploying dropped every such chat's price at once: no notice, no history
// (maturing points unprotected), no announcements. Now the default lives in
// the database and the env only says where it should go:
//
//   settings { _id: "point_price_default", price, history: [{ old, new, at,
//              requested_at? }], pending?: { price, from, effective_at,
//              requested_at }, cancelled?: {...}, rev, created_at }
//
//   - first run: seeded from the env (so deploy this before changing it);
//   - env above the stored price: applies at once, logged in `history`;
//   - env below it: a platform `pending` decrease taking effect after
//     POINT_PRICE_NOTICE_DAYS; until then the stored price pays (from
//     effective_at on the pending price pays, whether or not the document
//     has caught up: point-price.js platformPointPrice);
//   - env back at or above the stored price while one is pending: it is
//     cancelled (`cancelled`), and the chats told of it hear so.
// Only the mini app follows the env, once per process (on its first load),
// so neither an old instance during a rollout nor the bot with another value
// can fight it; the bot reads the stored default, the env only as a
// fallback.
//
// Chats on the default get a creator decrease's treatment by MERGING, not
// by materializing a pending decrease into every such chat: the platform's
// changes enter each chat's price history for the stretches it was on the
// default (point-price.js effectivePriceHistory / onDefaultAt, from the
// `from_default` both apps now record on every history entry). Pricing then
// stays a pure function of the chat document and this one, right for every
// chat the moment the change is stored - also for chats that join the
// default later, or that a batch job has not reached - with no per-chat
// write that could half fail. So members see the drop ahead
// (upcomingPointPrice) and in the history, points still maturing at it keep
// the earlier price (lot-pricing.js; with the chat's current maturation
// setting, as there is no per-chat snapshot of a platform change), and the
// claim rules guard it like a creator's decrease. Unlike one, its date is
// the same for every chat (not extended to each chat's claim days).
//
// Telling them does need per-chat writes: the bot queues the "will drop"
// announcement, and once it is in effect the "dropped" one, in every chat on
// the default, in bounded batches (index.mjs queuePlatformAnnouncements),
// keyed `<chat_id>:<type>:platform:<requested_at ms>` so a batch can run
// again; cancellations are queued here, to the chats that got one.
//
// "Back to default" decreases aim at where the default is heading (a
// platform pending price, else the current one) and store that price in
// pending.price: both apps pay and log exactly it, and the chat lands on the
// default only if it is the default in force by then (landsOnDefault), else
// it keeps that price as its own - never a move nobody announced.

const SETTINGS = 'settings';
const ID = 'point_price_default';
const BATCH = 500;

function storedError(what, value) {
    const error = new Error(`the stored platform default point price has an invalid ${what} (${String(value)})`);
    error.status = 500;
    return error;
}

function price(value) {
    const canonical = typeof value === 'string' ? canonicalDecimal(value.trim()) : null;
    return canonical !== null && !/^0(\.0*)?$/.test(canonical) ? canonical : null;
}

// The stored document as point-price.js uses it. A corrupted price refuses
// (500) like a corrupted chat price; unreadable history entries are skipped.
function platformState(doc) {
    const current = price(doc?.price);
    if (current === null) throw storedError('price', doc?.price);
    let pending = null;
    if (doc.pending) {
        const p = doc.pending;
        if (price(p.price) === null || price(p.from) === null || !(p.effective_at instanceof Date)) {
            throw storedError('pending decrease', JSON.stringify(p));
        }
        pending = {
            price: price(p.price),
            from: price(p.from),
            effective_at: p.effective_at,
            requested_at: p.requested_at instanceof Date ? p.requested_at : null,
        };
    }
    const history = (Array.isArray(doc.history) ? doc.history : [])
        .filter((h) => price(h?.old) !== null && price(h?.new) !== null && h.at instanceof Date)
        .map((h) => ({ old: price(h.old), new: price(h.new), at: h.at, requested_at: h.requested_at ?? null }));
    return { price: current, pending, history };
}

// What following `env` (canonical) does to the stored document at `now`: a
// Mongo update, or null when nothing changes. A due pending decrease is
// written out first.
function planPlatformSync(doc, env, now = new Date(), noticeDays = pointPriceNoticeDays()) {
    const $set = {};
    const $unset = {};
    const history = [];
    let current = doc.price;
    let pending = doc.pending ?? null;
    if (pending && pending.effective_at.getTime() <= now.getTime()) {
        history.push({ old: pending.from, new: pending.price, at: pending.effective_at, requested_at: pending.requested_at });
        current = pending.price;
        $set.price = current;
        $unset.pending = '';
        pending = null;
    }
    const target = pending ? pending.price : current;
    if (compareDecimal(env, target) !== 0) {
        if (compareDecimal(env, current) < 0) {
            delete $unset.pending;
            $set.pending = { price: env, from: current, effective_at: decreaseEffectiveAt(now, noticeDays), requested_at: now };
        } else {
            if (pending) {
                $unset.pending = '';
                // what the chats that heard "will drop" are told now:
                // 1 point stays `stays`
                $set.cancelled = { ...pending, stays: env, at: now };
            }
            if (compareDecimal(env, current) > 0) {
                history.push({ old: current, new: env, at: now });
                $set.price = env;
            }
        }
    }
    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    if (history.length) update.$push = { history: { $each: history } };
    if (Object.keys(update).length === 0) return null;
    update.$inc = { rev: 1 };
    update.$currentDate = { updated_at: true };
    return update;
}

let synced = false;

async function followEnv(col, doc, now) {
    let env;
    try {
        env = envPointPrice();
    } catch (e) {
        console.error(`platform price: ${e.message}; keeping the stored ${doc.price}`);
        return doc;
    }
    const state = platformState(doc);
    const update = planPlatformSync({ ...doc, price: state.price, pending: state.pending }, env, now);
    if (!update) return doc;
    const res = await col.updateOne({ _id: ID, rev: doc.rev ?? null }, update);
    // another instance followed the same env meanwhile: theirs stands
    if (res.matchedCount > 0) {
        const pending = update.$set?.pending;
        console.warn(
            `platform price: JETTONS_PER_POINT is ${env}, stored ${state.price}` +
                (pending
                    ? `: decrease scheduled for ${pending.effective_at.toISOString()}`
                    : update.$set?.cancelled
                      ? ': pending decrease cancelled'
                      : update.$set?.price
                        ? `: now ${update.$set.price}`
                        : ''),
        );
    }
    return col.findOne({ _id: ID });
}

// The chats that were told of a cancelled platform decrease hear that it is
// off, once: rows keyed like the bot's, in batches.
async function announceCancelled(col, doc, now) {
    const c = doc.cancelled;
    if (!c || c.announced_at || !(c.requested_at instanceof Date)) return;
    const ref = c.requested_at.getTime();
    const told = await (await getCollection('announcements'))
        .find({ platform: ref, type: ANNOUNCE.scheduled }, { projection: { chat_id: 1 } })
        .toArray();
    const docs = told.map((row) => ({
        ...announcementDoc(
            row.chat_id,
            { type: ANNOUNCE.cancelled, params: { from: c.stays, to: c.price, symbol: null }, ref: `platform:${ref}` },
            c.at,
        ),
        platform: ref,
    }));
    for (let i = 0; i < docs.length; i += BATCH) await writeAnnouncements(docs.slice(i, i + BATCH));
    await col.updateOne({ _id: ID, 'cancelled.requested_at': c.requested_at }, { $set: { 'cancelled.announced_at': now } });
}

// Reads the platform default for this request and hands it to point-price.js
// (every route that prices calls this first). Seeds it from the env on the
// very first run, and follows the env once per process.
async function loadPlatformDefault(now = new Date()) {
    const col = await getCollection(SETTINGS);
    let doc = await col.findOne({ _id: ID });
    if (!doc) {
        await col
            .updateOne({ _id: ID }, { $setOnInsert: { price: envPointPrice(), history: [], rev: 0, created_at: now } }, { upsert: true })
            .catch((e) => {
                if (e?.code !== 11000) throw e; // seeded by another instance meanwhile
            });
        doc = await col.findOne({ _id: ID });
    } else if (!synced) {
        doc = await followEnv(col, doc, now);
    }
    synced = true;
    const state = platformState(doc);
    setPlatformDefault(state);
    if (doc.cancelled && !doc.cancelled.announced_at) {
        await announceCancelled(col, doc, now).catch((e) => console.error('platform price: announcing the cancellation failed', e));
    }
    return state;
}

// Tests: forget what this process loaded and followed.
function resetPlatformDefault() {
    synced = false;
    setPlatformDefault(null);
}

module.exports = { SETTINGS, ID, platformState, planPlatformSync, loadPlatformDefault, resetPlatformDefault };
