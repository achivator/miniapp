const { getTonConfig } = require('./ton/config');
const { parseRate, pointsToJettons } = require('./ton/amounts');

// Price of a point: how many jettons one point pays out, per chat.
//
// The chat creator may set their own price (chats.point_price, a canonical
// decimal string); without one the platform default JETTONS_PER_POINT
// applies. It is off-chain like the claim rules: the pool contract only
// checks the backend's signature and daily limit, so the price is whatever
// the backend sizes the voucher with - which is why every points -> jettons
// conversion must go through pointPriceFor() and never read the env rate.
//
// Changing it re-prices points members already earned, so every change is
// kept in chats.point_price_history ({ old, new, at, by, maturation_days },
// effective prices) and shown to members on their dashboard for a week.
//
// The history is also what values points (lot-pricing.js): points still
// maturing when a decrease took effect keep the earlier price. So it is never
// trimmed - a decrease dropped from it would stop protecting its points - and
// each entry snapshots the chat's maturation_days in force when it took
// effect, so changing the maturation later does not re-value old points.
// Entries written before the snapshot existed have no maturation_days; they
// are valued with the chat's current setting (the best that is known).
//
// Raising the price (or saving the same one) applies at once. Lowering it
// takes points' value away from members, so it waits POINT_PRICE_NOTICE_DAYS
// (longer when the claim rules leave members no full claim window in that
// time, see noticeEffectiveAt) in chats.point_price_pending and the bot tells
// the chat to claim first:
//   { price, to_default, from, symbol, effective_at, requested_at, by,
//     maturation_days }
// `price` is the target effective price; `to_default` means the bot must
// $unset point_price (back to the platform rate) rather than set it;
// `maturation_days` is the chat's setting, kept in step by claim-settings
// saves until effective_at, and copied into the history entry the decrease
// becomes (by the bot, or by a save here). The bot applies a due decrease and
// announces it, but nothing here waits for it: once effective_at has passed,
// pointPriceFor() already returns the target. Only one decrease can be
// pending per chat.

// Jetton decimals assumed when the jetton is unknown at save time (TEP-64
// default, and the most any common jetton uses); re-checked at claim time.
const FALLBACK_DECIMALS = 9;
// A typo guard, not an economic rule: 1M jettons per point is far above any
// sane loyalty rate, and it keeps vouchers well inside the 120-bit coins field.
const MAX_POINT_PRICE = '1000000';
const MAX_INPUT_LENGTH = 32;
const RECENT_CHANGE_DAYS = 7;
const DEFAULT_NOTICE_DAYS = 7;
const MAX_NOTICE_DAYS = 30;
const DAY_MS = 86400 * 1000;

// Announcement types written to the `announcements` outbox for the bot.
const ANNOUNCE = {
    scheduled: 'price_decrease_scheduled',
    cancelled: 'price_decrease_cancelled',
    increased: 'price_increased',
    // the mini app wrote out a due decrease the bot had not applied (the bot
    // announces the ones it applies itself)
    decreased: 'price_decreased',
};

// Scheduling a decrease while no claim window can ever come (see
// noticeEffectiveAt).
const CLAIMS_PAUSED_NO_END =
    'claims are paused with no end date: members could not claim before the decrease; resume claims or set a resume date first';

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// "007.50" -> "7.5": one spelling per value, so stored prices compare as
// strings and "no change" is detected reliably.
function canonicalDecimal(str) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(str);
    if (!m) return null;
    const whole = m[1].replace(/^0+(?=\d)/, '');
    const frac = (m[2] || '').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

function fractionDigits(price) {
    const dot = price.indexOf('.');
    return dot === -1 ? 0 : price.length - dot - 1;
}

// Compares two canonical decimal strings exactly (no floats).
function compareDecimal(a, b) {
    const ra = parseRate(a);
    const rb = parseRate(b);
    const left = ra.num * rb.den;
    const right = rb.num * ra.den;
    return left === right ? 0 : left < right ? -1 : 1;
}

// Validates a submitted price and returns its canonical string; throws on
// invalid input. `decimals` is the chat jetton's, or null when unknown.
// Strings only: a JS number would already have gone through float rounding.
function normalizePointPrice(raw, decimals = null) {
    if (typeof raw !== 'string') throw new Error('price must be a decimal string, e.g. "0.01"');
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
        throw new Error('price must be a decimal string, e.g. "0.01"');
    }
    const price = canonicalDecimal(trimmed);
    if (price === null) throw new Error('price must be a decimal string, e.g. "0.01"');
    if (parseRate(price).num === 0n) throw new Error('price must be greater than 0');
    if (compareDecimal(price, MAX_POINT_PRICE) > 0) {
        throw new Error(`price must be at most ${MAX_POINT_PRICE} jettons per point`);
    }
    // Finer than the jetton's smallest unit would make pointsToJettons floor
    // every payout - to zero for a single point.
    const dec = Number.isInteger(decimals) ? decimals : FALLBACK_DECIMALS;
    if (fractionDigits(price) > dec) {
        throw new Error(`this jetton has ${dec} decimals: the price can have at most ${dec} digits after the point`);
    }
    return price;
}

// Platform default from JETTONS_PER_POINT. Not bounds-checked: it is the
// operator's setting, and an unparseable one throws exactly as before.
function platformPointPrice() {
    const raw = String(getTonConfig().jettonsPerPoint).trim();
    const price = canonicalDecimal(raw);
    if (price === null) throw new Error(`invalid JETTONS_PER_POINT: ${raw}`);
    return price;
}

// Days a price decrease waits before it applies (POINT_PRICE_NOTICE_DAYS,
// integer 0-30). A bad value falls back to the default rather than to 0:
// a typo must not silently remove members' notice.
function pointPriceNoticeDays() {
    const raw = process.env.POINT_PRICE_NOTICE_DAYS;
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_NOTICE_DAYS;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= MAX_NOTICE_DAYS ? n : DEFAULT_NOTICE_DAYS;
}

function invalidStored(what, value) {
    return httpError(500, `the chat's ${what} is invalid (${String(value)}); its creator must set it again`);
}

// The price stored on the chat itself (point_price or the platform default),
// ignoring any pending decrease. A stored value that fails validation means
// the document was edited by hand: refuse rather than silently pay a
// different rate (the creator can fix it by saving a new price).
function storedPointPrice(chat) {
    const stored = chat?.point_price;
    if (stored === undefined || stored === null) return platformPointPrice();
    try {
        return normalizePointPrice(stored);
    } catch {
        throw invalidStored('stored point price', stored);
    }
}

// A snapshotted maturation period (days), or null when there is none
// (written before snapshots existed) or it is unreadable: the caller then
// uses the chat's current setting. Its range was checked when the setting was
// saved (claim-rules.js, not imported: this file is also bundled for the
// browser).
function snapshotMaturationDays(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function hasPendingPointPrice(chat) {
    return chat?.point_price_pending !== undefined && chat?.point_price_pending !== null;
}

// The pending decrease, validated, or null when none is scheduled. Throws
// (500) on a malformed one for the same reason as storedPointPrice(): the
// price a member is paid must never be a guess.
function pendingPointPrice(chat) {
    if (!hasPendingPointPrice(chat)) return null;
    const p = chat.point_price_pending;
    const effectiveAt = p.effective_at instanceof Date ? p.effective_at : new Date(NaN);
    let price;
    try {
        price = normalizePointPrice(p.price);
    } catch {
        throw invalidStored('scheduled point price', p.price);
    }
    if (Number.isNaN(effectiveAt.getTime())) throw invalidStored('scheduled price date', p.effective_at);
    return {
        price,
        to_default: p.to_default === true,
        from: p.from === undefined || p.from === null ? null : String(p.from),
        symbol: p.symbol ?? null,
        effective_at: effectiveAt,
        requested_at: p.requested_at ?? null,
        by: p.by ?? null,
        maturation_days: snapshotMaturationDays(p.maturation_days),
    };
}

// The price a due decrease lands on. For a "back to the platform default"
// decrease that is the default as it is now, not as it was when scheduled:
// once the bot applies it (by unsetting point_price) the live default is
// what pays, so reading it here keeps the price identical whether or not the
// bot has run yet.
function pendingTarget(pending) {
    return pending.to_default ? platformPointPrice() : pending.price;
}

function isDue(pending, now) {
    return pending !== null && pending.effective_at.getTime() <= now.getTime();
}

// The chat's effective price at `now`: a pending decrease counts from its
// effective_at on, whether or not the bot has applied it yet.
function pointPriceFor(chat, now = new Date()) {
    const pending = pendingPointPrice(chat);
    if (isDue(pending, now)) return pendingTarget(pending);
    return storedPointPrice(chat);
}

// Whether the effective price at `now` is the creator's own (vs. the
// platform default).
function hasCustomPointPrice(chat, now = new Date()) {
    let pending = null;
    try {
        pending = pendingPointPrice(chat);
    } catch {
        // a malformed pending: fall back to what is stored
    }
    if (isDue(pending, now)) return !pending.to_default;
    return chat?.point_price !== undefined && chat?.point_price !== null;
}

// The decrease members still have time to claim before, or null (none, or
// already in effect).
function upcomingPointPrice(chat, now = new Date()) {
    const pending = pendingPointPrice(chat);
    return pending !== null && !isDue(pending, now) ? pending : null;
}

function isPriceDecrease(from, to) {
    return compareDecimal(to, from) < 0;
}

// When a decrease requested at `now` applies. Notice 0 means right away:
// the decrease is still recorded as pending so the bot announces it when it
// applies it.
function decreaseEffectiveAt(now = new Date(), noticeDays = pointPriceNoticeDays()) {
    return new Date(now.getTime() + noticeDays * DAY_MS);
}

// ---- Claim windows during the notice ----
//
// The notice is only worth something if members can claim during it, and the
// claim rules (claim-rules.js) may keep claims closed for most of it: claims
// open on some UTC weekdays only, or paused until a date. So a decrease never
// takes effect before members had one full claim window in it: a UTC day of
// open claims (MIN_CLAIM_WINDOW_MS in a row). Where the notice holds none it
// is extended to the end of the first one. With claims open every day any
// notice of a day or more already holds one, so it changes nothing. Claims
// paused with no end date have no window at all: no decrease is scheduled
// then (and the claim rules cannot pause claims while one is pending).
//
// `settings` are normalized claim settings (claimSettingsOf): plain data, so
// this file does not import claim-rules.js (it is bundled for the browser).
// Dates are epoch ms here, epoch seconds in API responses.

const MIN_CLAIM_WINDOW_MS = DAY_MS;

// When a pause set in the claim rules ends: -Infinity when there is none,
// Infinity when it has no end date.
function claimPauseEndMs(settings) {
    if (!settings?.paused) return -Infinity;
    const until = settings.paused_until;
    return until === null || until === undefined ? Infinity : until * 1000;
}

function isClaimDay(settings, dayStartMs) {
    const days = settings?.claim_days || [];
    return days.length === 0 || days.includes(new Date(dayStartMs).getUTCDay());
}

// The stretches of open claims in [fromMs, toMs), in order, consecutive open
// days merged: [{ start, end }] (epoch ms).
function claimWindows(settings, fromMs, toMs) {
    const windows = [];
    const from = Math.max(fromMs, claimPauseEndMs(settings));
    if (!(toMs > from)) return windows;
    for (let day = Math.floor(from / DAY_MS) * DAY_MS; day < toMs; day += DAY_MS) {
        if (!isClaimDay(settings, day)) continue;
        const start = Math.max(day, from);
        const end = Math.min(day + DAY_MS, toMs);
        const last = windows[windows.length - 1];
        if (last && last.end === start) last.end = end;
        else windows.push({ start, end });
    }
    return windows;
}

// When a decrease whose notice ends at `effectiveAt` may take effect, so that
// members get a full claim window between `now` and then: `effectiveAt` when
// the notice already holds one, else the end of the first one (a later
// Date), or null when claims are paused with no end date. No notice
// (effectiveAt <= now) stays none: the operator turned it off.
function noticeEffectiveAt(settings, now, effectiveAt) {
    const nowMs = now.getTime();
    const effMs = effectiveAt.getTime();
    if (!(effMs > nowMs)) return effectiveAt;
    const reopen = Math.max(nowMs, claimPauseEndMs(settings));
    if (reopen === Infinity) return null;
    // a claim day starts within a week of claims reopening, and ends a day
    // after that
    const horizon = Math.max(effMs, reopen + 8 * DAY_MS);
    const first = claimWindows(settings, nowMs, horizon).find((w) => w.end - w.start >= MIN_CLAIM_WINDOW_MS);
    if (!first) return null;
    const covered = first.start + MIN_CLAIM_WINDOW_MS;
    return covered <= effMs ? effectiveAt : new Date(covered);
}

// When members can claim before a decrease taking effect at `effectiveAt`,
// for API responses: the open windows from `now` (epoch seconds) and whether
// claims stay open the whole time.
function serializeClaimWindows(settings, now, effectiveAt) {
    const nowMs = now.getTime();
    const effMs = effectiveAt.getTime();
    const windows = claimWindows(settings, nowMs, effMs);
    return {
        claim_windows: windows.map((w) => ({ start: toEpochSec(w.start), end: toEpochSec(w.end) })),
        claims_open_throughout: windows.length === 1 && windows[0].start === nowMs && windows[0].end === effMs,
    };
}

// What a decrease requested at `now` would do, for the price card:
// `effective_at` null means it cannot be scheduled (claims paused with no end
// date); `extended` that the claim rules pushed it past the notice.
function decreasePreview(settings, now = new Date(), noticeDays = pointPriceNoticeDays()) {
    const noticeEnds = decreaseEffectiveAt(now, noticeDays);
    const effectiveAt = noticeEffectiveAt(settings, now, noticeEnds);
    return {
        effective_at: effectiveAt ? toEpochSec(effectiveAt) : null,
        notice_ends_at: toEpochSec(noticeEnds),
        extended: effectiveAt !== null && effectiveAt.getTime() > noticeEnds.getTime(),
        ...(effectiveAt
            ? serializeClaimWindows(settings, now, effectiveAt)
            : { claim_windows: [], claims_open_throughout: false }),
    };
}

// Whether `price` can be paid exactly in a jetton with `decimals`: one point
// must be worth a whole number of the jetton's smallest units.
function priceFitsDecimals(price, decimals) {
    return Number.isInteger(decimals) && fractionDigits(price) <= decimals;
}

// Points -> jetton units at the chat's current price. The one conversion
// routes use, so none of them can fall back to the platform rate by mistake.
function chatPointsToUnits(chat, points, decimals, now = new Date()) {
    return pointsToJettons(points, pointPriceFor(chat, now), decimals);
}

function toEpochSec(at) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// The history entry a due decrease becomes (the bot logs the same one when it
// applies it).
function pendingHistoryEntry(pending) {
    return {
        old: pending.from,
        new: pendingTarget(pending),
        at: pending.effective_at,
        by: pending.by,
        maturation_days: pending.maturation_days,
    };
}

// The history as members should see it: a decrease that is due but that the
// bot has not applied yet already pays, so it is listed as a change at its
// effective_at.
function effectivePriceHistory(chat, now = new Date()) {
    const history = Array.isArray(chat?.point_price_history) ? chat.point_price_history : [];
    let pending = null;
    try {
        pending = pendingPointPrice(chat);
    } catch {
        return history;
    }
    if (!isDue(pending, now)) return history;
    const entry = pendingHistoryEntry(pending);
    return entry.old === entry.new ? history : [...history, entry];
}

// The latest price change if it happened within the last week, for the
// member-facing "rate changed" notice; `changes` counts all changes in that
// window so several quick edits (down, then back up) are not hidden.
function recentPointPriceChange(chat, nowSec = Math.floor(Date.now() / 1000)) {
    const history = effectivePriceHistory(chat, new Date(nowSec * 1000));
    const since = nowSec - RECENT_CHANGE_DAYS * 86400;
    const recent = history.filter((h) => {
        const at = toEpochSec(h?.at);
        return at !== null && at > since && at <= nowSec;
    });
    if (recent.length === 0) return null;
    const last = recent.reduce((a, b) => (toEpochSec(b.at) >= toEpochSec(a.at) ? b : a));
    return { old: String(last.old), new: String(last.new), at: toEpochSec(last.at), changes: recent.length };
}

// History entries for API responses, newest first.
function serializePriceHistory(chat, limit = 10, now = new Date()) {
    return effectivePriceHistory(chat, now)
        .slice(-limit)
        .reverse()
        .map((h) => ({ old: String(h.old), new: String(h.new), at: toEpochSec(h.at), by: h.by ?? null }));
}

// Pending decrease for API responses (epoch seconds, like every other date
// the API returns), or null. `price` is what it will pay: for a "back to
// default" decrease, the default as it is now.
function serializePendingPrice(pending) {
    if (!pending) return null;
    return {
        price: pendingTarget(pending),
        to_default: pending.to_default,
        from: pending.from,
        symbol: pending.symbol,
        effective_at: toEpochSec(pending.effective_at),
    };
}

// Mongo filter matching the pending state we read, so a write based on it
// fails if the bot applied the decrease, or another save replaced it,
// meanwhile. requested_at identifies a pending (the bot conditions on it too).
function pendingFilter(chat) {
    return hasPendingPointPrice(chat)
        ? { 'point_price_pending.requested_at': chat.point_price_pending.requested_at ?? null }
        : { point_price_pending: null };
}

// Decides what saving `next` (a canonical price, or null for the platform
// default) does to the chat, as data the route executes: the conditional
// `filter`, the `update`, and the `announcements` for the bot (in order,
// possibly empty). `before`/`after` are the effective prices now and once the
// save applies. Returns null when nothing would change.
//
// A decrease waits `noticeDays` in point_price_pending (replacing any other
// pending one; requesting the same target again is a no-op, so it neither
// restarts the notice nor re-announces). Anything else applies now and
// cancels a pending decrease. A decrease that is already due but not yet
// applied by the bot is written out first (point_price + its history entry +
// a price_decreased announcement, since the bot, finding its pending gone,
// neither applies nor announces it).
//
// `claimSettings` (claimSettingsOf(chat), passed in by the route) extends a
// new decrease's notice to hold a full claim window (noticeEffectiveAt), and
// refuses it (409) while claims are paused with no end date; without it the
// notice is exactly `noticeDays`.
//
// `maturationDays` is the chat's current maturation setting
// (claimSettingsOf(chat).maturation_days, passed in by the route): it is
// snapshotted into every history entry and into a new pending decrease; a due
// decrease keeps its own snapshot (one scheduled before snapshots existed
// gets this one).
function planPointPriceChange(
    chat,
    next,
    {
        now = new Date(),
        noticeDays = pointPriceNoticeDays(),
        by = null,
        symbol = null,
        maturationDays = null,
        claimSettings = null,
    } = {},
) {
    const stored = chat?.point_price === undefined ? null : chat.point_price;
    // A malformed pending (hand-edited) is dropped by any save, like a
    // corrupted stored price: claims are refused until the creator saves.
    let pending = null;
    let malformed = false;
    try {
        pending = pendingPointPrice(chat);
    } catch {
        malformed = true;
    }
    const due = isDue(pending, now);
    const live = pending !== null && !due ? pending : null;

    let before;
    let beforeValid = !malformed;
    try {
        before = malformed ? storedPointPrice(chat) : pointPriceFor(chat, now);
    } catch {
        before = String(stored); // replacing a corrupted value
        beforeValid = false;
    }
    const target = next ?? platformPointPrice();

    const history = [];
    const announcements = [];
    if (due) {
        const dueEntry = pendingHistoryEntry(pending);
        if (dueEntry.maturation_days === null) dueEntry.maturation_days = maturationDays;
        if (dueEntry.old !== dueEntry.new) history.push(dueEntry);
        // `to` is what was actually applied: the live default for to_default,
        // which the operator may have raised since, so only a real drop is
        // announced as one.
        if (dueEntry.old !== null && isPriceDecrease(dueEntry.old, dueEntry.new)) {
            announcements.push({
                type: ANNOUNCE.decreased,
                params: { from: dueEntry.old, to: dueEntry.new, symbol: symbol ?? pending.symbol },
                ref: pendingRef(pending),
            });
        }
    }
    // What point_price holds once a due decrease is written out.
    const settled = due ? (pending.to_default ? null : pending.price) : stored;

    const $set = {};
    const $unset = {};
    const setStored = (value) => {
        if (value === null) $unset.point_price = '';
        else $set.point_price = value;
    };
    let after;

    // A corrupted current price cannot be compared, and nobody can claim at
    // it anyway: the fix applies at once, as before.
    if (beforeValid && isPriceDecrease(before, target)) {
        // Same target as the decrease already waiting: keep its date.
        if (live !== null && (next === null ? live.to_default : !live.to_default && next === live.price)) return null;
        after = before;
        if (settled !== stored) setStored(settled);
        let effectiveAt = decreaseEffectiveAt(now, noticeDays);
        if (claimSettings) {
            effectiveAt = noticeEffectiveAt(claimSettings, now, effectiveAt);
            if (effectiveAt === null) throw httpError(409, CLAIMS_PAUSED_NO_END);
        }
        $set.point_price_pending = {
            price: target,
            to_default: next === null,
            from: before,
            symbol,
            effective_at: effectiveAt,
            requested_at: now,
            by,
            maturation_days: maturationDays,
        };
        // With no notice there is nothing to warn about ahead: the bot's own
        // "price decreased" message, when it applies it, is the announcement.
        if (effectiveAt.getTime() > now.getTime()) {
            announcements.push({
                type: ANNOUNCE.scheduled,
                params: { from: before, to: target, symbol, effective_at: effectiveAt },
                ref: now.getTime(),
            });
        }
    } else {
        if (pending === null && !malformed && next === stored) return null;
        after = target;
        if (next !== stored) setStored(next);
        if (pending !== null || malformed) $unset.point_price_pending = '';
        // the effective price did not move (e.g. custom = platform default):
        // nothing for members to be warned about
        if (before !== target) history.push({ old: before, new: target, at: now, by, maturation_days: maturationDays });
        if (beforeValid && compareDecimal(target, before) > 0) {
            announcements.push({
                type: ANNOUNCE.increased,
                params: { from: before, to: target, symbol, cancelled_pending: live !== null },
                ref: now.getTime(),
            });
        } else if (live !== null) {
            announcements.push({
                type: ANNOUNCE.cancelled,
                params: { from: before, to: pendingTarget(live), symbol: symbol ?? live.symbol },
                ref: pendingRef(live),
            });
        }
    }

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    // never $slice: every decrease must stay (see the top of this file)
    if (history.length) update.$push = { point_price_history: { $each: history } };
    return {
        filter: { id: chat.id, point_price: stored, ...pendingFilter(chat) },
        update,
        announcements,
        before,
        after,
    };
}

// Explicitly cancelling the pending decrease. Throws 409 when there is none
// or it already took effect (members may have claimed at the new price).
function planPointPriceCancel(chat, { now = new Date(), symbol = null } = {}) {
    if (!hasPendingPointPrice(chat)) throw httpError(409, 'no price decrease is scheduled');
    const stored = chat.point_price === undefined ? null : chat.point_price;
    const filter = { id: chat.id, point_price: stored, ...pendingFilter(chat) };
    const update = { $unset: { point_price_pending: '' } };
    let pending;
    try {
        pending = pendingPointPrice(chat);
    } catch {
        // malformed: nothing meaningful to announce, just clear it
        return { filter, update, announcements: [], before: null, after: null };
    }
    if (isDue(pending, now)) throw httpError(409, 'the price decrease already took effect; set a new price instead');
    let before = null;
    try {
        before = storedPointPrice(chat);
    } catch {
        // corrupted stored price: still cancel, but there is no price to name
    }
    return {
        filter,
        update,
        announcements:
            before === null
                ? []
                : [
                      {
                          type: ANNOUNCE.cancelled,
                          params: { from: before, to: pendingTarget(pending), symbol: symbol ?? pending.symbol },
                          ref: pendingRef(pending),
                      },
                  ],
        before,
        after: before,
    };
}

// ---- The announcements outbox ----
//
// The price is saved on the chat first and its announcements are queued
// after it, in another collection. Production MongoDB may be a single node
// without a replica set, so the two writes cannot share a transaction:
// instead every row has a deterministic `key`, `<chat_id>:<type>:<ref>`,
// where `ref` (epoch ms) names what the row is about - the requested_at of
// the decrease it schedules, cancels or writes out, or the moment of an
// increase. Writing a row twice then queues it once (the bot keeps a unique
// index on `key`), which makes the one row that must never go missing
// reconcilable: the "will drop" announcement of a pending decrease
// (scheduledAnnouncement). Each read of the chat here re-queues it when the
// save that scheduled the decrease could not (lib/announcements.js), and so
// does the bot's announcement pass for decreases older than two minutes,
// with the same key and row.

function announcementKey(chatId, type, ref) {
    return `${chatId}:${type}:${ref}`;
}

// What a pending decrease's rows are keyed by: its requested_at (the bot
// conditions on it too), else - a hand-made pending - its effective_at.
function pendingRef(pending) {
    const at = pending.requested_at instanceof Date ? pending.requested_at : pending.effective_at;
    return at.getTime();
}

// The "will drop" announcement the chat's pending decrease was scheduled
// with, as the save queued it, or null when it has none: no pending (or a
// malformed one), already due (the bot announces it as applied instead), or
// scheduled with no notice.
function scheduledAnnouncement(chat, now = new Date()) {
    let pending = null;
    try {
        pending = pendingPointPrice(chat);
    } catch {
        return null;
    }
    if (pending === null || isDue(pending, now) || !(pending.requested_at instanceof Date)) return null;
    if (pending.effective_at.getTime() <= pending.requested_at.getTime()) return null;
    return {
        type: ANNOUNCE.scheduled,
        params: { from: pending.from, to: pendingTarget(pending), symbol: pending.symbol, effective_at: pending.effective_at },
        ref: pending.requested_at.getTime(),
    };
}

// The outbox row the bot drains (sent_at/claimed_at/attempts are its own
// bookkeeping). `now` is its created_at, the bot's sending order: a row
// queued late by a reconcile keeps the moment of the save it belongs to.
function announcementDoc(chatId, announcement, now = new Date()) {
    return {
        key: announcementKey(chatId, announcement.type, announcement.ref ?? now.getTime()),
        chat_id: chatId,
        type: announcement.type,
        params: announcement.params,
        created_at: now,
        sent_at: null,
        claimed_at: null,
        attempts: 0,
    };
}

module.exports = {
    FALLBACK_DECIMALS,
    MAX_POINT_PRICE,
    RECENT_CHANGE_DAYS,
    DEFAULT_NOTICE_DAYS,
    MAX_NOTICE_DAYS,
    ANNOUNCE,
    MIN_CLAIM_WINDOW_MS,
    CLAIMS_PAUSED_NO_END,
    canonicalDecimal,
    compareDecimal,
    normalizePointPrice,
    platformPointPrice,
    pointPriceNoticeDays,
    storedPointPrice,
    snapshotMaturationDays,
    pendingPointPrice,
    upcomingPointPrice,
    pendingTarget,
    pointPriceFor,
    hasCustomPointPrice,
    isPriceDecrease,
    decreaseEffectiveAt,
    claimPauseEndMs,
    claimWindows,
    noticeEffectiveAt,
    serializeClaimWindows,
    decreasePreview,
    priceFitsDecimals,
    chatPointsToUnits,
    effectivePriceHistory,
    recentPointPriceChange,
    serializePriceHistory,
    serializePendingPrice,
    planPointPriceChange,
    planPointPriceCancel,
    pendingFilter,
    announcementKey,
    scheduledAnnouncement,
    announcementDoc,
};
