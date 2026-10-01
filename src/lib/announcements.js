const { getCollection } = require('./mongo');
const { ANNOUNCE, announcementDoc, scheduledAnnouncement } = require('./point-price');

// Writes to the `announcements` outbox the bot drains (see the outbox notes
// in point-price.js): idempotent by `key`, so a retry - or the bot's own
// reconcile pass racing it - never queues a row twice.

const DUPLICATE_KEY = 11000;

function isDuplicateKey(e) {
    return e?.code === DUPLICATE_KEY || Boolean(e?.writeErrors?.some?.((w) => w.code === DUPLICATE_KEY));
}

// Queues `docs` (announcementDoc rows) in order, each only if no row has its
// key yet. Throws when the outbox cannot be written.
async function writeAnnouncements(docs) {
    if (docs.length === 0) return;
    const col = await getCollection('announcements');
    const ops = docs.map(({ key, ...doc }) => ({
        updateOne: { filter: { key }, update: { $setOnInsert: doc }, upsert: true },
    }));
    for (let attempt = 0; ; attempt++) {
        try {
            await col.bulkWrite(ops, { ordered: true });
            return;
        } catch (e) {
            // two writers upserted the same key at once: the unique index let
            // one in, and the retry finds it
            if (attempt > 0 || !isDuplicateKey(e)) throw e;
        }
    }
}

function sameMoment(a, b) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}

// Re-queues the "will drop" announcement of each chat's pending decrease
// when the save that scheduled it could not queue it (miniapp#15). Rows
// queued before keys existed have none; they are matched by chat and
// effective_at. Returns how many rows it queued.
async function reconcileAnnouncements(chats, now = new Date()) {
    const expected = [];
    for (const chat of chats) {
        const announcement = chat ? scheduledAnnouncement(chat, now) : null;
        // created when the decrease was saved, so it keeps its place in the
        // chat's order (e.g. before a cancellation saved since)
        if (announcement) expected.push(announcementDoc(chat.id, announcement, new Date(announcement.ref)));
    }
    if (expected.length === 0) return 0;
    // No created_at bound: a row queued before keys existed may be dated a
    // moment before its decrease's requested_at, and missing it would announce
    // the decrease twice.
    const rows = await (await getCollection('announcements'))
        .find(
            { chat_id: { $in: expected.map((doc) => doc.chat_id) }, type: ANNOUNCE.scheduled },
            { projection: { key: 1, chat_id: 1, 'params.effective_at': 1 } },
        )
        .toArray();
    const missing = expected.filter(
        (doc) =>
            !rows.some(
                (row) =>
                    row.key === doc.key ||
                    (row.key == null && row.chat_id === doc.chat_id && sameMoment(row.params?.effective_at, doc.params.effective_at)),
            ),
    );
    await writeAnnouncements(missing);
    return missing.length;
}

// For routes that only read: a reconcile that fails must not fail the page.
async function reconcileAnnouncementsQuietly(chats, now = new Date()) {
    try {
        const queued = await reconcileAnnouncements(chats, now);
        if (queued > 0) console.warn(`announcements: re-queued ${queued} missing price decrease announcement(s)`);
        return queued;
    } catch (e) {
        console.error('announcements: reconcile failed', e);
        return 0;
    }
}

module.exports = { writeAnnouncements, reconcileAnnouncements, reconcileAnnouncementsQuietly };
